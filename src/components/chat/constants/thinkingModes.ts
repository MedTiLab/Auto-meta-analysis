import { Atom, Brain, Circle, Gauge, Sparkles, Zap } from 'lucide-react';

export const thinkingModes = [
  {
    id: 'none',
    name: 'Default',
    description: 'Use the Claude SDK default thinking behavior',
    icon: Circle,
    color: 'text-gray-600',
  },
  {
    id: 'low',
    name: 'Low',
    description: 'Minimal thinking, fastest responses',
    icon: Gauge,
    color: 'text-slate-600',
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Moderate thinking',
    icon: Brain,
    color: 'text-blue-600',
  },
  {
    id: 'high',
    name: 'High',
    description: 'Deep reasoning',
    icon: Zap,
    color: 'text-indigo-600',
  },
  {
    id: 'xhigh',
    name: 'XHigh',
    description: 'Deeper than high',
    icon: Sparkles,
    color: 'text-purple-600',
  },
  {
    id: 'max',
    name: 'Max',
    description: 'Maximum effort',
    icon: Atom,
    color: 'text-red-600',
  },
];
