// Threat Evaluation Engine utility

export function calculateThreatScore(activeFactors, customRules = null) {
  let score = 0;
  const factorBreakdown = [];

  activeFactors.forEach(factor => {
    let weight = factor.weight;
    if (customRules && customRules[factor.id] !== undefined) {
      weight = customRules[factor.id];
    }
    score += weight;
    factorBreakdown.push({
      id: factor.id,
      name: factor.name,
      delta: weight,
      desc: factor.desc,
      category: factor.category || 'General'
    });
  });

  // Clamp threat score between 0 and 100
  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));

  let severity = 'LOW';
  let severityColor = '#10B981'; // Green
  let badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

  if (normalizedScore >= 80) {
    severity = 'CRITICAL';
    severityColor = '#EF4444'; // Red
    badgeClass = 'bg-red-500/10 text-red-400 border-red-500/30';
  } else if (normalizedScore >= 60) {
    severity = 'HIGH';
    severityColor = '#F97316'; // Orange-Red
    badgeClass = 'bg-orange-500/10 text-orange-400 border-orange-500/30';
  } else if (normalizedScore >= 30) {
    severity = 'MEDIUM';
    severityColor = '#F59E0B'; // Amber
    badgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  }

  return {
    score: normalizedScore,
    severity,
    severityColor,
    badgeClass,
    factors: factorBreakdown,
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
  };
}

export const SEVERITY_LEVELS = {
  LOW: { min: 0, max: 29, label: 'LOW RISK', color: '#10B981', bg: 'bg-emerald-500/15' },
  MEDIUM: { min: 30, max: 59, label: 'MEDIUM RISK', color: '#F59E0B', bg: 'bg-amber-500/15' },
  HIGH: { min: 60, max: 79, label: 'HIGH RISK', color: '#F97316', bg: 'bg-orange-500/15' },
  CRITICAL: { min: 80, max: 100, label: 'CRITICAL THREAT', color: '#EF4444', bg: 'bg-red-500/15' },
};
