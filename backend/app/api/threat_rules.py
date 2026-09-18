from typing import List, Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import ThreatRule
from app.schemas.schemas import (
    ThreatRuleResponse, 
    ThreatRuleUpdate, 
    ThreatCalculationRequest, 
    ThreatCalculationResponse
)
from app.services.threat_engine import evaluate_threat, DEFAULT_RULES

router = APIRouter(prefix="/threat-rules", tags=["Threat Rules & Evaluation"])

@router.get("", response_model=List[ThreatRuleResponse])
def get_threat_rules(db: Session = Depends(get_db)):
    rules = db.query(ThreatRule).all()
    if not rules:
        for rule_id, data in DEFAULT_RULES.items():
            db.add(ThreatRule(
                id=rule_id,
                name=data["name"],
                weight=data["weight"],
                category=data["category"],
                enabled=True,
                description=f"Rule factor for {data['name']}"
            ))
        db.commit()
        rules = db.query(ThreatRule).all()
    return rules

@router.put("/{rule_id}", response_model=ThreatRuleResponse)
def update_threat_rule(rule_id: str, payload: ThreatRuleUpdate, db: Session = Depends(get_db)):
    rule = db.query(ThreatRule).filter(ThreatRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.weight = payload.weight
    if payload.enabled is not None:
        rule.enabled = payload.enabled
    db.commit()
    db.refresh(rule)
    return rule

@router.post("/calculate", response_model=ThreatCalculationResponse)
def calculate_threat(payload: ThreatCalculationRequest):
    active_factor_ids = []
    for f in payload.factors:
        if isinstance(f, str):
            active_factor_ids.append(f)
        elif hasattr(f, "factor_id") and getattr(f, "detected", True):
            active_factor_ids.append(f.factor_id)
    result = evaluate_threat(active_factor_ids, payload.custom_weights)
    return ThreatCalculationResponse(**result)
