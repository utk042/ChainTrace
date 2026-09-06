"""
ChainTrace Forensics — Evidence confidence

Two different questions get asked about a flagged wallet, and the system used
to answer only one of them while labelling it as the other.

    Risk score        How far this wallet's behaviour sits from the typical
                      wallet in this dataset. A ranking, 0-100.

    Evidence          How much independent support the finding has. Whether
    confidence        anything corroborates the statistical outlier, and
                      whether that corroboration is a deterministic pattern
                      match or another estimate.

They are not the same thing, and one does not imply the other. A wallet can
score 95 on the strength of a single statistical detector — unusual, with
nothing to say why — while another scores 72 with a peel chain, a mixer
interaction and a watchlist neighbour all pointing the same way. The second
is the better lead, and the score alone says the opposite.

The old code stored the score in a column named `confidence` and the
interface printed it as "95.0% confidence", which reads as a 95% probability
that the wallet is criminal. It is not that, it was never that, and no
anomaly score can be that: the model is trained on unlabelled data and has
never been shown a crime.

What the detectors are worth, and why:

  Structural detectors — peel chains, CoinJoin-like mixing, consolidation
  hubs — are deterministic pattern matches over the actual transaction graph.
  They can be checked by hand. A person can be shown the sequence.

  Watchlist proximity is operator-supplied ground truth propagated outward.
  At one hop it is a direct transaction with a wallet someone has designated
  illicit. Every further hop weakens it sharply: at three hops most of a
  well-connected graph is included, and the finding says almost nothing.

  The autoencoder is an unsupervised outlier detector. It says "unlike the
  others", which is a reason to look and not a finding in itself. On its own
  it never rises above LOW.
"""

from typing import Optional

HIGH = "HIGH"
MEDIUM = "MEDIUM"
LOW = "LOW"

# Detectors whose finding is a checkable pattern in the transaction graph
# rather than a statistical estimate.
STRUCTURAL_MODELS = frozenset({"Peel-Chain", "Mixer-Hub", "CoinJoin"})


def assess_evidence(
    models: list[str],
    *,
    peel_chain_depth: int = 0,
    mixer_interactions: int = 0,
    watchlist_hops: Optional[int] = None,
    anomaly_score: float = 0.0,
) -> dict:
    """
    Grade how well supported a finding is, independently of how anomalous it is.

    Returns {level, rationale, factors[]}, where each factor names what was
    observed, the value behind it, and how much weight it carries — so the
    grade can be argued with rather than taken on trust.
    """
    factors: list[dict] = []
    structural = [m for m in models if m in STRUCTURAL_MODELS]

    if peel_chain_depth and peel_chain_depth > 0:
        factors.append({
            "factor": "Peeling chain",
            "value": f"{peel_chain_depth} hops",
            "kind": "structural",
            "note": ("A repeated split-and-forward sequence, matched on the graph. "
                     "Used to launder funds — and also by ordinary wallet software "
                     "making change."),
        })

    if mixer_interactions and mixer_interactions > 0:
        factors.append({
            "factor": "Mixer interactions",
            "value": str(mixer_interactions),
            "kind": "structural",
            "note": ("Transactions with several equal-value outputs from multiple "
                     "distinct inputs — the CoinJoin shape. Mixing is not illegal "
                     "and has legitimate privacy uses."),
        })

    if "Mixer-Hub" in models:
        factors.append({
            "factor": "Consolidation hub",
            "value": "matched",
            "kind": "structural",
            "note": ("Many counterparties in and out, passing value through rather "
                     "than accumulating it."),
        })

    if watchlist_hops is not None:
        # One hop is a direct transaction with a designated wallet. Beyond
        # two, most of a connected graph qualifies and the signal is spent.
        weight = "strong" if watchlist_hops <= 1 else "weak" if watchlist_hops >= 3 else "moderate"
        factors.append({
            "factor": "Watchlist distance",
            "value": f"{watchlist_hops} hop{'s' if watchlist_hops != 1 else ''}",
            "kind": "watchlist",
            "weight": weight,
            "note": ("Proximity is not participation: a wallet two hops from a "
                     "designated address may simply have been paid by someone who "
                     "was paid by it."),
        })

    if "Autoencoder" in models:
        factors.append({
            "factor": "Statistical outlier",
            "value": f"score {anomaly_score:.1f}/100",
            "kind": "statistical",
            "note": ("How far this wallet's behaviour sits from the rest of this "
                     "dataset. The model is unsupervised — it has never been shown "
                     "a labelled crime, so this is not a probability of one."),
        })

    close_watchlist = watchlist_hops is not None and watchlist_hops <= 1
    independent = len(structural) + (1 if watchlist_hops is not None else 0)

    if (len(structural) >= 2) or (structural and close_watchlist):
        level = HIGH
        rationale = (
            f"{len(structural)} independent structural pattern"
            f"{'s' if len(structural) != 1 else ''} matched on the transaction graph"
            + (", and a direct transaction with a watchlisted wallet"
               if close_watchlist else "")
            + ". Each can be checked by hand against the underlying transactions."
        )
    elif structural or close_watchlist or independent >= 2:
        level = MEDIUM
        if structural:
            rationale = (
                f"One structural pattern matched ({structural[0]}), which is checkable "
                "against the transactions, but nothing independent corroborates it."
            )
        elif close_watchlist:
            rationale = (
                "A direct transaction with a watchlisted wallet, with no behavioural "
                "pattern supporting it."
            )
        else:
            rationale = "Two weak signals agree, neither of them a checkable pattern."
    else:
        level = LOW
        rationale = (
            "Only a statistical outlier"
            + (f", plus a distant watchlist link ({watchlist_hops} hops)"
               if watchlist_hops is not None else "")
            + ". Unusual behaviour is a reason to look, not a finding — nothing here "
              "identifies what the wallet was doing."
        )

    return {"level": level, "rationale": rationale, "factors": factors}


def score_caveat(anomaly_score: float) -> str:
    """The sentence that has to accompany the number wherever it is shown."""
    return (
        f"{anomaly_score:.1f} out of 100 is how far this wallet's behaviour sits from "
        "the typical wallet in this dataset. It ranks wallets for review; it is not a "
        "probability that any offence occurred."
    )
