"""
Risk score and evidence confidence must stay two different things.

The system used to answer one question and label it as the other: the alerts
column named `confidence` held the anomaly score, and the interface printed
it as "95.0% confidence" — an unsupervised outlier distance rendered as a
probability that a wallet was criminal. The model has never been shown a
labelled offence and cannot express such a probability.

These checks pin the separation:

  * every band is reachable, and reachable for the stated reason
  * a statistical outlier alone never grades above LOW, however high it scores
  * the grade is driven by corroboration, not by the score
  * the caveat that has to accompany the number says what the number is not

Run: python tests/confidence.py
"""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.ml.confidence import assess_evidence, score_caveat, HIGH, MEDIUM, LOW  # noqa: E402

FAILURES = []


def check(ok, label, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail else ''}")
    if not ok:
        FAILURES.append(label)


# ── The band a finding lands in, and why ─────────────────────────

# Two independent checkable patterns.
two_structural = assess_evidence(
    ["Autoencoder", "Peel-Chain", "Mixer-Hub"],
    peel_chain_depth=7, mixer_interactions=0, anomaly_score=71.0,
)
check(two_structural["level"] == HIGH,
      "two structural patterns grade HIGH", two_structural["level"])

# One pattern plus a direct transaction with a designated wallet.
structural_and_watchlist = assess_evidence(
    ["Autoencoder", "Peel-Chain"], peel_chain_depth=4, watchlist_hops=1, anomaly_score=64.0,
)
check(structural_and_watchlist["level"] == HIGH,
      "a pattern plus a direct watchlist link grades HIGH",
      structural_and_watchlist["level"])

# One pattern, nothing corroborating it.
one_structural = assess_evidence(
    ["Autoencoder", "CoinJoin"], mixer_interactions=3, anomaly_score=80.0,
)
check(one_structural["level"] == MEDIUM,
      "a single structural pattern grades MEDIUM", one_structural["level"])

# The case the whole change exists for: a very high score with nothing
# behind it must not outrank a modest score with corroboration.
outlier_only = assess_evidence(["Autoencoder"], anomaly_score=99.9)
check(outlier_only["level"] == LOW,
      "a statistical outlier alone grades LOW even at 99.9",
      f"{outlier_only['level']} at 99.9")
check(outlier_only["level"] != two_structural["level"],
      "a 99.9 outlier does not outrank a 71.0 with two patterns",
      f"99.9 -> {outlier_only['level']}, 71.0 -> {two_structural['level']}")

# Watchlist proximity decays with distance.
near = assess_evidence(["Autoencoder", "Risk-Propagation"], watchlist_hops=1, anomaly_score=50.0)
far = assess_evidence(["Autoencoder", "Risk-Propagation"], watchlist_hops=3, anomaly_score=50.0)
check(near["level"] == MEDIUM and far["level"] == LOW,
      "watchlist proximity weakens with distance",
      f"1 hop -> {near['level']}, 3 hops -> {far['level']}")

# ── Every grade has to be arguable, not asserted ─────────────────

for name, result in [("HIGH", two_structural), ("MEDIUM", one_structural), ("LOW", outlier_only)]:
    check(bool(result["rationale"]), f"{name} carries a rationale")
    check(bool(result["factors"]), f"{name} lists the factors behind it",
          f"{len(result['factors'])} factor(s)")
    for factor in result["factors"]:
        check(bool(factor.get("note")), f"{name}: '{factor['factor']}' explains itself")
        check(factor.get("kind") in ("structural", "watchlist", "statistical"),
              f"{name}: '{factor['factor']}' names what kind of evidence it is",
              factor.get("kind"))

# A structural factor must be marked as one, so the interface can show that
# it is checkable by hand rather than an estimate.
kinds = {f["factor"]: f["kind"] for f in two_structural["factors"]}
check(kinds.get("Peeling chain") == "structural", "a peel chain is structural evidence")
check(kinds.get("Statistical outlier") == "statistical",
      "the autoencoder is marked statistical, not structural")

# Where a heuristic has legitimate uses, the factor has to say so — an
# analyst reading "mixer" should not take it as an accusation.
mixer_note = next(f["note"] for f in one_structural["factors"] if f["factor"] == "Mixer interactions")
check("not illegal" in mixer_note, "the mixer factor notes that mixing is lawful",
      mixer_note[:60])
peel_note = next(f["note"] for f in two_structural["factors"] if f["factor"] == "Peeling chain")
check("wallet software" in peel_note,
      "the peel-chain factor notes its innocent explanation", peel_note[-60:])
watch_note = next(f["note"] for f in near["factors"] if f["factor"] == "Watchlist distance")
check("not participation" in watch_note,
      "the watchlist factor separates proximity from participation")

# ── The sentence that must travel with the number ────────────────

caveat = score_caveat(94.7)
check("94.7 out of 100" in caveat, "the caveat quotes the score it qualifies", caveat[:40])
check("not a probability" in caveat,
      "the caveat says the score is not a probability of an offence")
check("%" not in caveat, "the caveat never renders the score as a percentage")

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURES:\n  - " + "\n  - ".join(FAILURES))
    sys.exit(1)
print("Risk score and evidence confidence are graded independently.")
