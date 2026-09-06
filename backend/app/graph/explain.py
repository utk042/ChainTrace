"""
ChainTrace Forensics — Plain-language entity summaries

The inspector is accurate and unreadable unless you already do this for a
living. `fan_in_degree 0 / fan_out_degree 60`, `velocity_1h 60`,
`round_amount_ratio 0.2167` and a score of 100 are the evidence, but they are
not an explanation, and an investigator handing a case to a prosecutor, a
compliance officer or a judge cannot hand over that.

This restates the same record in sentences. It makes no new claim and runs no
new analysis: every line is derived from a value already on the entity's
record, and where a number drives a statement the number is quoted alongside
it so nothing here has to be taken on trust. Where the pipeline inferred
rather than observed — the co-input ownership heuristic above all — the
wording says so.
"""

from typing import Optional


def _btc(value) -> str:
    """An amount in BTC, without trailing zeros and without pretending to a
    precision the figure does not have."""
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return "an unrecorded amount"
    if amount == 0:
        return "0 BTC"
    if abs(amount) < 0.0001:
        # Dust: four decimals would round it to zero and read as "nothing
        # moved", so it is shown in full.
        return f"{amount:.8f} BTC"
    return f"{amount:,.4f}".rstrip("0").rstrip(".") + " BTC"


def _plural(count: int, singular: str, plural: str = None) -> str:
    return f"{count:,} {singular if count == 1 else (plural or singular + 's')}"


RISK_SENTENCE = {
    "Critical": "This entity is in the highest risk band the system assigns.",
    "High": "This entity is in the second-highest risk band.",
    "Elevated": "This entity is flagged as worth a look, below the two most serious bands.",
    "Normal": "Nothing about this entity's behaviour stood out to the scoring model.",
}


def _wallet_summary(entity_id: str, features: dict, detail: dict) -> list[str]:
    lines: list[str] = []

    tx_count = int(features.get("tx_count") or 0)
    received = features.get("total_received") or 0
    sent = features.get("total_sent") or 0
    fan_in = int(features.get("fan_in_degree") or 0)
    fan_out = int(features.get("fan_out_degree") or 0)

    if tx_count:
        lines.append(
            f"This is a Bitcoin wallet address. It appears in "
            f"{_plural(tx_count, 'transaction')} in the loaded data: it received "
            f"{_btc(received)} and sent {_btc(sent)}."
        )
    else:
        lines.append(
            "This is a Bitcoin wallet address. No transactions for it are in "
            "the loaded data."
        )

    # Only the sides that happened. "came in from 0 sources" reads as a
    # finding when it is just an absence.
    if fan_in and fan_out:
        lines.append(
            f"Money came in from {_plural(fan_in, 'source')} and went out to "
            f"{_plural(fan_out, 'destination')}."
        )
    elif fan_out:
        lines.append(
            f"It only ever paid out, to {_plural(fan_out, 'destination')}; nothing "
            "in this dataset shows where its funds came from."
        )
    elif fan_in:
        lines.append(
            f"It only ever received, from {_plural(fan_in, 'source')}; nothing in "
            "this dataset shows it spending."
        )

    balance = (received or 0) - (sent or 0)
    if tx_count and abs(balance) > 1e-9:
        if balance > 0:
            lines.append(
                f"{_btc(balance)} more arrived than left, so on this data it is "
                "still holding that much."
            )
        else:
            lines.append(
                f"{_btc(abs(balance))} more went out than came in, so it was "
                "funded by activity outside the loaded dataset."
            )

    age = features.get("age_days")
    if age is not None:
        try:
            days = float(age)
            if days < 1:
                lines.append(
                    "All of its activity falls inside a single day, which is "
                    "why the velocity figures below are high."
                )
            else:
                lines.append(f"Its activity spans about {days:,.1f} days.")
        except (TypeError, ValueError):
            pass

    velocity = features.get("velocity_1h")
    if velocity and float(velocity) >= 10:
        lines.append(
            f"At its busiest it handled {float(velocity):,.0f} transactions in one "
            "hour. A person moving their own money rarely does that; automation does."
        )

    countries = features.get("unique_countries")
    if countries and int(countries) > 1:
        lines.append(
            f"The transactions it appears in were seen from "
            f"{_plural(int(countries), 'country', 'countries')}"
            + (f" across {_plural(int(features.get('unique_ips') or 0), 'network address', 'network addresses')}."
               if features.get("unique_ips") else ".")
            + " That is a network-layer observation, not proof of where anyone was."
        )

    peel = features.get("peel_chain_depth")
    if peel and int(peel) > 0:
        lines.append(
            f"It sits in a peel chain {int(peel)} hops long — a pattern where a "
            "large amount is moved along a chain of addresses, a small piece "
            "split off at each step. It is used to launder funds, and also by "
            "ordinary wallet software making change."
        )

    mixer = features.get("mixer_interaction_count")
    if mixer and int(mixer) > 0:
        lines.append(
            f"It transacted with {_plural(int(mixer), 'address')} the pipeline "
            "classified as mixer-like — services that pool funds from many "
            "people to break the trail."
        )

    hops = features.get("darknet_proximity_hops")
    if hops is not None:
        lines.append(
            f"It is {_plural(int(hops), 'hop')} from an address on the watchlist. "
            "Proximity is not participation: a wallet two hops from a flagged "
            "address may simply have been paid by someone who was paid by it."
        )

    cluster = detail.get("cluster_id")
    if cluster is not None:
        lines.append(
            f"It was grouped into cluster {cluster}, meaning it was spent "
            "together with other addresses in that group. That is the "
            "common-input-ownership heuristic — a strong hint that one party "
            "controls them all, not a certainty."
        )

    return lines


def _transaction_summary(entity_id: str, features: dict) -> list[str]:
    lines = ["This is a single Bitcoin transaction."]

    inputs = features.get("input_count")
    outputs = features.get("output_count")
    total_in = features.get("total_input")
    total_out = features.get("total_output")

    if inputs is not None and outputs is not None:
        lines.append(
            f"It took money from {_plural(int(inputs), 'address', 'addresses')} "
            f"({_btc(total_in)}) and paid out to "
            f"{_plural(int(outputs), 'address', 'addresses')} ({_btc(total_out)})."
        )
    if features.get("fee") is not None:
        lines.append(f"The miner's fee was {_btc(features.get('fee'))}.")
    if features.get("timestamp"):
        lines.append(f"It was recorded at {features['timestamp']} UTC.")
    if inputs and int(inputs) > 1:
        lines.append(
            f"Because {int(inputs)} addresses were spent together here, the "
            "pipeline treats them as probably belonging to one party."
        )
    return lines


def _ip_summary(entity_id: str, detail: dict) -> list[str]:
    hits = detail.get("attributes", {}).get("hit_count")
    lines = [
        "This is a network address, not a wallet — it carries no money.",
    ]
    if hits:
        lines.append(
            f"It was observed carrying {_plural(int(hits), 'transaction')} in this "
            "data. Network-layer observations say where traffic appeared to come "
            "from; they can be shared, proxied or spoofed."
        )
    return lines


def explain_entity(detail: dict) -> Optional[dict]:
    """
    A plain-language reading of an entity record.

    Takes the dict `/api/graph/node/{id}` already builds, so it introduces no
    new query and cannot disagree with the panel it sits above.
    """
    if not detail.get("found"):
        return None

    node_type = detail.get("node_type")
    features = detail.get("features") or {}

    if node_type == "wallet":
        lines = _wallet_summary(detail["id"], features, detail)
    elif node_type == "transaction":
        lines = _transaction_summary(detail["id"], features)
    elif node_type == "ip":
        lines = _ip_summary(detail["id"], detail)
    else:
        return None

    # Why it was flagged, in the words of the models that flagged it.
    alerts = detail.get("alerts") or []
    risk_tier = detail.get("risk_tier") or "Normal"
    verdict = [RISK_SENTENCE.get(risk_tier, RISK_SENTENCE["Normal"])]

    score = detail.get("anomaly_score")
    if score:
        verdict.append(
            f"Its risk score is {float(score):.1f} out of 100. That is how far this "
            "entity's behaviour sits from the typical wallet in this dataset — it "
            "ranks wallets for review. It is not a probability that an offence "
            "occurred, and it cannot be: the model is trained on unlabelled data "
            "and has never been shown a crime."
        )
    if alerts:
        models = sorted({a.get("model") for a in alerts if a.get("model")})
        verdict.append(
            f"{_plural(len(alerts), 'alert')} were raised against it"
            + (f", by {', '.join(models)}." if models else ".")
        )
        # How well supported the finding is, which is a different question
        # from how anomalous it is — and the one that decides whether this is
        # worth an investigator's day.
        levels = [a.get("evidence_confidence") for a in alerts if a.get("evidence_confidence")]
        if levels:
            best = "HIGH" if "HIGH" in levels else "MEDIUM" if "MEDIUM" in levels else "LOW"
            rationale = next((a.get("evidence_rationale") for a in alerts
                              if a.get("evidence_confidence") == best
                              and a.get("evidence_rationale")), None)
            verdict.append(
                {
                    "HIGH": "Evidence confidence is HIGH: more than one independent "
                            "check points the same way.",
                    "MEDIUM": "Evidence confidence is MEDIUM: something checkable "
                              "supports this, but nothing corroborates it.",
                    "LOW": "Evidence confidence is LOW: this is an unusual-behaviour "
                           "flag with nothing independent behind it. Treat it as a "
                           "place to start looking, not as a finding.",
                }[best]
                + (f" {rationale}" if rationale else "")
            )

    return {
        "what_it_is": lines,
        "why_flagged": verdict,
        "caveat": (
            "Everything above is derived from the transactions loaded into "
            "this system and from patterns the models scored. It describes "
            "behaviour, not intent, and none of it identifies a person."
        ),
    }
