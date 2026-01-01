import React, { useState } from 'react';
import { DollarSign, Bitcoin, ArrowRight, Shield, TrendingUp, Zap, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { DepositModal } from '@/components/stack/DepositModal';
import { Link } from 'react-router-dom';

const RISK_PROFILES = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: '100% USDC on Aave',
    allocation: '100% USDC',
    apy: '3-5%',
    leverage: '1x',
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
  },
  {
    id: 'balanced-conservative',
    name: 'Balanced Conservative',
    description: '75% USDC / 25% GMX 3x BTC Long',
    allocation: '75% USDC / 25% Lev BTC',
    apy: '4-7%',
    leverage: '3x',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: '50% USDC / 50% GMX 3x BTC Long',
    allocation: '50% USDC / 50% Lev BTC',
    apy: '5-10%',
    leverage: '3x',
    color: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: '25% USDC / 75% GMX 3x BTC Long',
    allocation: '25% USDC / 75% Lev BTC',
    apy: '6-15%',
    leverage: '3x',
    color: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  },
  {
    id: 'very-aggressive',
    name: 'Very Aggressive',
    description: '100% GMX 4-5x BTC Long',
    allocation: '100% Lev BTC',
    apy: '8-20%',
    leverage: '4-5x',
    color: 'bg-red-500/10 text-red-600 border-red-500/20',
  },
] as const;

type DepositType = 'usd' | 'bitcoin' | null;
type RiskProfileId = typeof RISK_PROFILES[number]['id'] | null;

const StackApp = () => {
  const [selectedDepositType, setSelectedDepositType] = useState<DepositType>(null);
  const [selectedRiskProfile, setSelectedRiskProfile] = useState<RiskProfileId>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const { toast } = useToast();

  const handleDepositTypeSelect = (type: DepositType) => {
    setSelectedDepositType(type);
    toast({
      title: `${type === 'usd' ? 'USD' : 'Bitcoin'} deposit selected`,
      description: 'Now select your risk profile below',
    });
  };

  const handleRiskProfileSelect = (profileId: RiskProfileId) => {
    setSelectedRiskProfile(profileId);
  };

  const handleContinue = () => {
    if (!selectedDepositType) {
      toast({
        title: 'Please select deposit type',
        description: 'Choose USD or Bitcoin deposit method',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedRiskProfile) {
      toast({
        title: 'Please select risk profile',
        description: 'Choose your preferred risk tolerance',
        variant: 'destructive',
      });
      return;
    }

    setIsDepositModalOpen(true);
  };

  const selectedProfile = RISK_PROFILES.find(p => p.id === selectedRiskProfile);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-primary">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                  Stack App
                </h1>
                <p className="text-sm text-muted-foreground">Automated DeFi Leverage</p>
              </div>
            </div>
            <Link to="/">
              <Button variant="outline" className="flex items-center gap-2">
                <Home className="h-4 w-4" />
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Welcome Section */}
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
              Welcome to Stack App
            </h2>
            <p className="text-xl text-muted-foreground mb-2">
              Set your risk tolerance, we handle everything else
            </p>
            <p className="text-sm text-muted-foreground">
              Automated leverage exposure on GMX + Aave • US-compliant • No KYC required
            </p>
          </div>

          {/* Deposit Type Selection */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                How would you like to deposit?
              </CardTitle>
              <CardDescription>
                Choose your deposit method to get started
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button
                  variant={selectedDepositType === 'usd' ? 'default' : 'outline'}
                  size="lg"
                  className="h-24 flex-col gap-2"
                  onClick={() => handleDepositTypeSelect('usd')}
                >
                  <DollarSign className="h-8 w-8" />
                  <span className="text-lg font-semibold">Deposit USD</span>
                  <span className="text-xs text-muted-foreground">Credit/Debit Card</span>
                </Button>

                <Button
                  variant={selectedDepositType === 'bitcoin' ? 'default' : 'outline'}
                  size="lg"
                  className="h-24 flex-col gap-2"
                  onClick={() => handleDepositTypeSelect('bitcoin')}
                >
                  <Bitcoin className="h-8 w-8" />
                  <span className="text-lg font-semibold">Deposit Bitcoin</span>
                  <span className="text-xs text-muted-foreground">Lightning Network</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Risk Profile Selection */}
          {selectedDepositType && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Select your risk profile
                </CardTitle>
                <CardDescription>
                  Choose your preferred risk/return allocation strategy
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={selectedRiskProfile || ''}
                  onValueChange={(value) => handleRiskProfileSelect(value as RiskProfileId)}
                  className="space-y-4"
                >
                  {RISK_PROFILES.map((profile) => (
                    <div key={profile.id} className="flex items-start space-x-3">
                      <RadioGroupItem
                        value={profile.id}
                        id={profile.id}
                        className="mt-1"
                      />
                      <Label
                        htmlFor={profile.id}
                        className={`flex-1 cursor-pointer p-4 rounded-lg border-2 transition-all ${
                          selectedRiskProfile === profile.id
                            ? `${profile.color} border-current`
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-semibold text-lg mb-1">
                              {profile.name}
                            </div>
                            <div className="text-sm text-muted-foreground mb-2">
                              {profile.description}
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <span className="font-medium">Allocation: {profile.allocation}</span>
                              <span className="font-medium">APY: {profile.apy}</span>
                              <span className="font-medium">Leverage: {profile.leverage}</span>
                            </div>
                          </div>
                        </div>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          )}

          {/* Continue Button */}
          {selectedDepositType && selectedRiskProfile && (
            <div className="flex justify-center">
              <Button
                size="lg"
                className="px-8 py-6 text-lg"
                onClick={handleContinue}
              >
                Continue to Deposit
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Info Section */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">US-Compliant</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Fully accessible to US users with no KYC required for deposits under $10k
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Automated</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Set your risk tolerance once. We handle all conversions, allocations, and rebalancing automatically.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Risk-Managed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Automatic liquidation prevention and position monitoring to protect your capital
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Deposit Modal */}
      {selectedDepositType && selectedRiskProfile && (
        <DepositModal
          isOpen={isDepositModalOpen}
          onClose={() => setIsDepositModalOpen(false)}
          depositType={selectedDepositType}
          riskProfile={selectedProfile!}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-border/50 mt-16">
        <div className="container mx-auto px-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            Powered by GMX • Aave V3 • Avalanche C-Chain • Square Payments
          </p>
          <p className="text-center text-xs text-muted-foreground mt-2">
            This product involves risk. Automated leverage trading can result in total loss of capital.
            Not investment advice.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default StackApp;

