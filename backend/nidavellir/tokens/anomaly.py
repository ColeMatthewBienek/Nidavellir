from __future__ import annotations

from enum import StrEnum


class AnomalyType(StrEnum):
    INPUT_SPIKE       = "input_spike"
    OUTPUT_SPIKE      = "output_spike"
    HIGH_DISCREPANCY  = "high_discrepancy"


INPUT_SPIKE_MULTIPLIER   = 3.0
OUTPUT_SPIKE_MULTIPLIER  = 3.0
HIGH_DISCREPANCY_THRESHOLD = 100.0   # percent


def detect_anomalies(
    record: dict,
    baseline_avg_input:  float | None = None,
    baseline_avg_output: float | None = None,
) -> list[dict]:
    anomalies: list[dict] = []

    input_t  = record.get("reported_input_tokens")
    output_t = record.get("reported_output_tokens")
    discrep  = record.get("discrepancy_pct")

    # Input spike
    if (input_t is not None and baseline_avg_input is not None
            and baseline_avg_input > 0
            and input_t > baseline_avg_input * INPUT_SPIKE_MULTIPLIER):
        anomalies.append({
            "type":        AnomalyType.INPUT_SPIKE,
            "severity":    "high",
            "description": f"Input tokens {input_t} is {input_t/baseline_avg_input:.1f}× baseline {baseline_avg_input:.0f}",
        })

    # Output spike
    if (output_t is not None and baseline_avg_output is not None
            and baseline_avg_output > 0
            and output_t > baseline_avg_output * OUTPUT_SPIKE_MULTIPLIER):
        anomalies.append({
            "type":        AnomalyType.OUTPUT_SPIKE,
            "severity":    "medium",
            "description": f"Output tokens {output_t} is {output_t/baseline_avg_output:.1f}× baseline {baseline_avg_output:.0f}",
        })

    # High discrepancy between preflight estimate and provider-reported
    if discrep is not None and discrep >= HIGH_DISCREPANCY_THRESHOLD:
        anomalies.append({
            "type":        AnomalyType.HIGH_DISCREPANCY,
            "severity":    "medium",
            "description": f"Discrepancy {discrep:.1f}% between preflight and provider-reported tokens",
        })

    return anomalies
