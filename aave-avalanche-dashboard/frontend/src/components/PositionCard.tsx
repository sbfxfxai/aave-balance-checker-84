import React from 'react';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Shield, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PositionCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: 'supplied' | 'borrowed' | 'health' | 'available';
  trend?: 'up' | 'down';
  isLoading?: boolean;
}

const iconMap = {
  supplied: TrendingUp,
  borrowed: TrendingDown,
  health: Shield,
  available: Wallet,
};

export function PositionCard({ title, value, subtitle, icon, trend, isLoading }: PositionCardProps) {
  const Icon = iconMap[icon];
  
  const getHealthColor = (value: string) => {
    if (value === '∞') return 'text-success';
    const numValue = parseFloat(value);
    if (numValue > 2) return 'text-success';
    if (numValue > 1.5) return 'text-amber-500';
    return 'text-destructive';
  };

  const isHealthFactor = icon === 'health';

  return (
    <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300 animate-slide-up">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <div className={cn(
              "p-2 rounded-lg",
              icon === 'supplied' && "bg-primary/10",
              icon === 'borrowed' && "bg-destructive/10",
              icon === 'health' && "bg-success/10",
              icon === 'available' && "bg-accent/10"
            )}>
              <Icon className={cn(
                "h-5 w-5",
                icon === 'supplied' && "text-primary",
                icon === 'borrowed' && "text-destructive",
                icon === 'health' && "text-success",
                icon === 'available' && "text-accent"
              )} />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
          </div>
          
          {isLoading ? (
            <div className="h-8 w-24 bg-muted animate-pulse rounded" />
          ) : (
            <p className={cn(
              "text-3xl font-bold",
              isHealthFactor && getHealthColor(value)
            )}>
              {value}
            </p>
          )}
          
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        
        {trend && !isLoading && (
          <div className={cn(
            "px-2 py-1 rounded-full text-xs font-medium",
            trend === 'up' ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          )}>
            {trend === 'up' ? '↑' : '↓'}
          </div>
        )}
      </div>
    </Card>
  );
}
