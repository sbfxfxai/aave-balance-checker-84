import React, { useState, useEffect } from 'react';
import { DollarSign, ArrowRight, Shield, TrendingUp, Zap, Home, Bitcoin, Landmark, Sparkles, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { DepositModal } from '@/components/stack/DepositModal';
import { ValueDiagram } from '@/components/stack/ValueDiagram';
import { Footer } from '@/components/Footer';
import { Link } from 'react-router-dom';
import { OptimizedLogo } from '@/components/OptimizedLogo';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';

// Helper to calculate blended APY based on USDC allocation percentage
const calculateBlendedAPY = (usdcPercent: number, aaveAPY: number, btcLevReturn: number = 15) => {
  const usdcComponent = (usdcPercent / 100) * aaveAPY;
  const btcComponent = ((100 - usdcPercent) / 100) * btcLevReturn;
  return usdcComponent + btcComponent;
};

// Generate risk profiles with real Aave APY
const getRiskProfiles = (aaveAPY: number) => [
  {
    id: 'conservative',
    name: 'Conservative',
    description: '100% Savings',
    allocation: '100% USDC',
    apy: `${aaveAPY.toFixed(2)}%`,
    leverage: '1x',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  },
  {
    id: 'morpho',
    name: 'Morpho Vault',
    description: '50/50 Gauntlet + Hyperithm',
    allocation: '50% Gauntlet USDC Core / 50% Hyperithm USDC',
    apy: '6.08%',
    leverage: '1x',
    color: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: '100% Bitcoin 2.5x',
    allocation: '100% Lev BTC',
    apy: 'Varies',
    leverage: '2.5x',
    color: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  },
] as const;

type DepositType = 'usd' | null;
type RiskProfileId = 'conservative' | 'morpho' | 'aggressive' | null;

const StackApp = () => {
  const [selectedDepositType, setSelectedDepositType] = useState<DepositType>(null);
  const [selectedRiskProfile, setSelectedRiskProfile] = useState<RiskProfileId>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [aaveAPY, setAaveAPY] = useState<number>(3.5); // Default fallback
  const { toast } = useToast();

  // Fetch real Aave USDC rates on mount
  useEffect(() => {
    const fetchAaveRates = async () => {
      try {
        const runtimeApiBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
        const response = await fetch(`${runtimeApiBaseUrl}/api/aave/rates`);
        const data = await response.json();
        if (data.success && data.supplyAPY) {
          setAaveAPY(data.supplyAPY);
        }
      } catch (error) {
        console.error('Failed to fetch Aave rates:', error);
      }
    };
    fetchAaveRates();
    // Refresh every 5 minutes
    const interval = setInterval(fetchAaveRates, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Generate risk profiles with current Aave APY
  const riskProfiles = getRiskProfiles(aaveAPY);

  const handleDepositTypeSelect = (type: DepositType) => {
    setSelectedDepositType(type);
    toast({
      title: 'USD deposit selected',
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
        description: 'Choose USD deposit method',
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

    // If aggressive strategy, redirect to Bitcoin page
    if (selectedRiskProfile === 'aggressive') {
      window.location.href = '/gmx';
      return;
    }

    setIsDepositModalOpen(true);
  };

  const selectedProfile = riskProfiles.find((p: { id: string }) => p.id === selectedRiskProfile);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <Link to="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="font-bold text-primary-foreground text-sm">TV</span>
                </div>
                <span className="text-lg sm:text-xl font-bold text-foreground">TiltVault</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">Auto</span>
              </Link>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              <a href="#comparison" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
                Compare
              </a>
              <a href="#why-ergc" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
                Why ERGC?
              </a>
              <a href="#faq" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
                FAQ
              </a>
            </nav>
            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href="https://app.uniswap.org/explore/pools/avalanche/0x3c83d0058e9d1652534be264dba75cfcc2e1d48a3ff1d2c3611a194a361a16ee"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 hover:border-purple-500/50 transition-colors text-xs font-medium text-purple-400 hover:text-purple-300"
                title="Get ERGC on Uniswap - 100+ ERGC = 56% fee discount"
              >
                <Zap className="h-3 w-3" />
                <span>Get ERGC</span>
                <ExternalLink className="h-3 w-3" />
              </a>
              <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
                <Link to="/" aria-label="Go to Banking page">
                  <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Banking">
                    <Home className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Banking</span>
                  </Button>
                </Link>
                <Link to="/gmx" aria-label="Go to Bitcoin trading page">
                  <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Bitcoin">
                    <Bitcoin className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Bitcoin</span>
                  </Button>
                </Link>
                <Link to="/stack" aria-label="Go to Auto Invest page">
                  <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Auto Invest">
                    <Zap className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Auto</span>
                  </Button>
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative min-h-screen">
        {/* Background glow effects */}
        <div className="absolute inset-0 bg-gradient-glow opacity-50" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-success/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 py-12 relative z-10">
          <div className="max-w-4xl mx-auto">
            {/* Hero Section */}
            <section className="text-center mb-12 sm:mb-16 px-2">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary border border-border mb-8 animate-fade-in">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Automated Investing</span>
              </div>

              {/* Main heading */}
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
                Deposit USD,{" "}
                <span className="text-gradient-primary">Earn DeFi Returns</span>
              </h1>

              {/* Subtitle */}
              <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 animate-fade-in" style={{ animationDelay: '0.2s' }}>
                Use your debit card for instant access—hold 100 ERGC for zero fees
              </p>

              {/* Call to Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12 animate-fade-in" style={{ animationDelay: '0.3s' }}>
                <Button
                  size="lg"
                  className="bg-gradient-primary text-white hover:opacity-90 px-8 py-6 text-lg font-semibold"
                  onClick={() => {
                    const depositSection = document.querySelector('[data-testid="deposit-usd-button"]');
                    if (depositSection) {
                      depositSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                >
                  Start Earning <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="px-8 py-6 text-lg font-semibold border-border hover:bg-muted"
                  onClick={() => {
                    const faqSection = document.querySelector('#faq');
                    if (faqSection) {
                      faqSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                >
                  Learn More
                </Button>
              </div>

              {/* Key features */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-12 animate-fade-in" style={{ animationDelay: '0.4s' }}>
                <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-primary" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">High-Yield</p>
                  <p className="text-xs text-muted-foreground">via Aave</p>
                </div>
                </div>

                <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-success" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">2.5x Leverage</p>
                  <p className="text-xs text-muted-foreground">Bitcoin positions</p>
                </div>
                </div>

                <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-warning" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">US Designed</p>
                  <p className="text-xs text-muted-foreground">Simple & Secure</p>
                </div>
                </div>
              </div>
            </section>

          {/* Deposit Type Selection */}
          <Card className="mb-8 card-gradient border-border animate-fade-in" style={{ animationDelay: '0.5s' }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Select Deposit Method
              </CardTitle>
              <CardDescription>
                Step 1: Choose how you want to deposit funds
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                <Button
                  variant={selectedDepositType === 'usd' ? 'default' : 'outline'}
                  size="lg"
                  className="h-24 flex-col gap-2"
                  onClick={() => handleDepositTypeSelect('usd')}
                  data-testid="deposit-usd-button"
                >
                  <DollarSign className="h-8 w-8" />
                  <span className="text-lg font-semibold">Deposit USD</span>
                  <span className="text-xs text-muted-foreground">Debit Card</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Risk Profile Selection */}
          {selectedDepositType && (
            <Card className="mb-8 card-gradient border-border animate-fade-in" style={{ animationDelay: '0.6s' }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Select your risk profile
                </CardTitle>
                <CardDescription>
                  Step 2: Choose your preferred risk/return allocation strategy
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={selectedRiskProfile || ''}
                  onValueChange={(value) => handleRiskProfileSelect(value as RiskProfileId)}
                  className="space-y-4"
                >
                  {riskProfiles.map((profile) => (
                    <div key={profile.id} className="flex items-start space-x-3">
                      <RadioGroupItem
                        value={profile.id}
                        id={profile.id}
                        className="mt-1"
                        data-testid={`risk-profile-${profile.id}`}
                      />
                      <Label
                        htmlFor={profile.id}
                        className={`flex-1 cursor-pointer p-4 rounded-lg border-2 transition-all ${selectedRiskProfile === profile.id
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
            <div className="flex justify-center mt-8 animate-fade-in" style={{ animationDelay: '0.7s' }}>
              <Button
                size="lg"
                className="px-12 py-8 text-xl font-bold shadow-xl hover:scale-105 transition-transform"
                onClick={handleContinue}
              >
                Continue to Deposit
                <ArrowRight className="ml-2 h-6 w-6" />
              </Button>
            </div>
          )}

          {/* Value Diagram - Shows ERGC savings impact */}
          <ValueDiagram aaveAPY={aaveAPY} />
          </div>
        </div>
      </main>

      {/* Deposit Modal */}
      {selectedDepositType && selectedRiskProfile && (
        <DepositModal
          isOpen={isDepositModalOpen}
          onClose={() => setIsDepositModalOpen(false)}
          riskProfile={selectedProfile!}
        />
      )}

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default StackApp;

