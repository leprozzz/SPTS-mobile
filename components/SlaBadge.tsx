
import React from 'react';
import { SLA_MAP } from '../constants';

interface SlaBadgeProps {
  sla?: string;
}

export const SlaBadge: React.FC<SlaBadgeProps> = ({ sla }) => {
  if (!sla) return <div className="w-3 h-3 rounded-full bg-green-500" title="NO SLA" />;
  
  const slaLower = sla.toLowerCase();
  
  // Red for 2h and 4h
  if (SLA_MAP.RED.some(v => slaLower.includes(v))) {
    return (
      <div className="relative flex items-center justify-center">
        <div className="absolute w-4 h-4 rounded-full bg-red-500 animate-ping opacity-25" />
        <div className="w-3 h-3 rounded-full bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.5)]" />
      </div>
    );
  }
  
  // Yellow for 12h and 24h
  if (SLA_MAP.YELLOW.some(v => slaLower.includes(v))) {
    return <div className="w-3 h-3 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.4)]" />;
  }
  
  // Green for everything else (>24h or No SLA)
  return <div className="w-3 h-3 rounded-full bg-green-500" />;
};
