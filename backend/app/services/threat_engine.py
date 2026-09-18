from typing import List, Dict, Any

DEFAULT_RULES = {
    "rule_restricted_intrusion": {"name": "Restricted-zone intrusion", "weight": 30, "category": "Spatial"},
    "rule_movement_sensitive": {"name": "Movement toward sensitive zone", "weight": 20, "category": "Kinematic"},
    "rule_watchlist_vehicle": {"name": "Watchlist vehicle detected", "weight": 40, "category": "Intelligence"},
    "rule_watchlist_face": {"name": "Watchlist person / face identified", "weight": 40, "category": "Intelligence"},
    "rule_night_movement": {"name": "Night-time movement", "weight": 15, "category": "Temporal"},
    "rule_loitering": {"name": "Loitering detection", "weight": 15, "category": "Behavioral"},
    "rule_unverified_identity": {"name": "Unknown / unverified identity", "weight": 10, "category": "Identity"},
    "rule_multi_camera_transit": {"name": "Multi-camera cross-sector transit", "weight": 20, "category": "Kinematic"},
    "rule_cross_perimeter_intrusion": {"name": "Cross-perimeter intrusion progression", "weight": 25, "category": "Spatial"},
    "rule_authorized_personnel": {"name": "Authorized personnel verification", "weight": -30, "category": "Override"}
}

def evaluate_threat(active_factor_ids: List[str], custom_weights: Dict[str, int] = None) -> Dict[str, Any]:
    raw_score = 0
    breakdown = []
    
    weights = {k: v["weight"] for k, v in DEFAULT_RULES.items()}
    if custom_weights:
        weights.update(custom_weights)

    for factor_id in active_factor_ids:
        if factor_id in DEFAULT_RULES:
            weight = weights.get(factor_id, DEFAULT_RULES[factor_id]["weight"])
            raw_score += weight
            breakdown.append({
                "id": factor_id,
                "name": DEFAULT_RULES[factor_id]["name"],
                "delta": weight,
                "category": DEFAULT_RULES[factor_id]["category"]
            })

    # Clamp normalized score strictly between 0 and 100
    normalized_score = max(0, min(100, raw_score))

    if normalized_score >= 80:
        severity = "CRITICAL"
    elif normalized_score >= 60:
        severity = "HIGH"
    elif normalized_score >= 30:
        severity = "MEDIUM"
    else:
        severity = "LOW"

    return {
        "score": normalized_score,
        "severity": severity,
        "breakdown": breakdown,
        "ethical_disclaimer": "Threat scoring represents event priority and operational perimeter risk, not criminal intent."
    }
