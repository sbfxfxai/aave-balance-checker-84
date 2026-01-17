import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DollarSign, ArrowRight, Shield, TrendingUp, Zap, Home, Bitcoin, Landmark, Sparkles, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { DepositModal } from '@/components/stack/DepositModal';
import { ValueDiagram } from '@/components/stack/ValueDiagram';
import { Footer } from '@/components/Footer';
import { Link } from 'react-router-dom';
import { useErgcPurchaseModal } from '@/contexts';
import { OptimizedLogo } from '@/components/OptimizedLogo';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { useAaveRates } from '@/hooks/useAaveRates';

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
    icon: Shield,
    iconColor: 'text-green-500',
    apyColor: 'text-green-500',
    isRecommended: false,
  },
  {
    id: 'morpho',
    name: 'Morpho Vault',
    description: '50/50 Gauntlet + Hyperithm',
    allocation: '50% Gauntlet USDC Core / 50% Hyperithm USDC',
    apy: '6.08%',
    leverage: '1x',
    icon: TrendingUp,
    iconColor: 'text-green-500',
    apyColor: 'text-green-500',
    isRecommended: true,
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: '100% Bitcoin 2.5x',
    allocation: '100% Lev BTC',
    apy: 'Varies',
    leverage: '2.5x',
    icon: Zap,
    iconColor: 'text-yellow-500',
    apyColor: 'text-orange-500',
    isRecommended: false,
  },
] as const;

type DepositType = 'usd' | null;
type RiskProfileId = 'conservative' | 'morpho' | 'aggressive' | null;

const StackApp = () => {
  const { openModal } = useErgcPurchaseModal();
  const [selectedDepositType, setSelectedDepositType] = useState<DepositType>(null);
  const [selectedRiskProfile, setSelectedRiskProfile] = useState<RiskProfileId>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const { supplyAPY: aaveAPY } = useAaveRates();
  const { toast } = useToast();
  const modalOpeningRef = useRef(false); // Prevent duplicate modal opens

  // Generate risk profiles with current Aave APY - recalculate when APY changes
  const riskProfiles = useMemo(() => getRiskProfiles(aaveAPY), [aaveAPY]);

  const handleDepositTypeSelect = (type: DepositType) => {
    setSelectedDepositType(type);
    // Don't show toast, just show the full-screen risk profile selection
  };

  const handleRiskProfileSelect = (profileId: RiskProfileId) => {
    setSelectedRiskProfile(profileId);
    
    // Auto-proceed to deposit modal for conservative and morpho
    // Aggressive redirects to GMX page
    if (profileId === 'aggressive') {
      window.location.href = '/gmx';
      return;
    }
  };

  // Auto-open deposit modal when a profile is selected (conservative or morpho)
  useEffect(() => {
    if (selectedDepositType && selectedRiskProfile && 
        (selectedRiskProfile === 'conservative' || selectedRiskProfile === 'morpho') &&
        !isDepositModalOpen && !modalOpeningRef.current) {
      modalOpeningRef.current = true;
      setIsDepositModalOpen(true);
    }
  }, [selectedDepositType, selectedRiskProfile, isDepositModalOpen]);

  // Reset the ref when modal closes
  useEffect(() => {
    if (!isDepositModalOpen) {
      modalOpeningRef.current = false;
    }
  }, [isDepositModalOpen]);

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

  // Memoize selectedProfile to ensure it updates when riskProfiles changes (live APY)
  const selectedProfile = useMemo(() => {
    if (!selectedRiskProfile) return null;
    return riskProfiles.find((p: { id: string }) => p.id === selectedRiskProfile) || null;
  }, [riskProfiles, selectedRiskProfile]);

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
              <button
                onClick={openModal}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 hover:border-purple-500/50 transition-colors text-xs font-medium text-purple-400 hover:text-purple-300"
                title="Get ERGC - Buy directly or trade on DEX"
              >
                <Zap className="h-3 w-3" />
                <span>Get ERGC</span>
                <ExternalLink className="h-3 w-3" />
              </button>
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
      <main className={`relative min-h-screen ${selectedDepositType && !selectedRiskProfile ? 'hidden' : ''}`}>
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

          {/* Risk Profile Selection - Hidden when showing full-screen */}

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

      {/* Full-Screen Risk Profile Selection */}
      {selectedDepositType && !selectedRiskProfile && (
        <div className="fixed inset-0 z-50 bg-background flex items-start justify-center p-4 overflow-y-auto pt-20">
          <div className="w-full max-w-7xl mx-auto py-8">
            {/* Header */}
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
                Select your risk profile
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground">
                Step 2: Choose your preferred risk/return allocation strategy
              </p>
            </div>

            {/* Risk Profile Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {riskProfiles.map((profile) => {
                const IconComponent = profile.icon;
                const isSelected = selectedRiskProfile === profile.id;
                
                return (
                  <div
                    key={profile.id}
                    onClick={() => handleRiskProfileSelect(profile.id as RiskProfileId)}
                    className={`
                      relative cursor-pointer rounded-lg border-2 transition-all
                      bg-muted/30 p-8 min-h-[320px] flex flex-col
                      ${isSelected 
                        ? 'border-green-500 shadow-lg shadow-green-500/20 scale-105' 
                        : 'border-border hover:border-primary/50 hover:scale-102'
                      }
                      ${profile.isRecommended ? 'border-green-500' : ''}
                    `}
                  >
                    {/* Recommended Badge */}
                    {profile.isRecommended && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                          RECOMMENDED
                        </span>
                      </div>
                    )}

                    {/* Icon - Top Left */}
                    <div className="mb-6 flex-shrink-0">
                      <IconComponent 
                        className={`h-12 w-12 ${profile.iconColor}`}
                        strokeWidth={profile.id === 'conservative' ? 2 : 1.5}
                        fill="none"
                      />
                    </div>

                    {/* Title */}
                    <h3 className="text-2xl font-semibold text-foreground mb-2">
                      {profile.name}
                    </h3>

                    {/* Description */}
                    <p className="text-sm text-muted-foreground mb-6">
                      {profile.description}
                    </p>

                    {/* Details */}
                    <div className="space-y-3 text-sm mt-auto">
                      <div className="font-medium text-foreground">
                        Allocation: {profile.allocation}
                      </div>
                      <div className="font-medium">
                        APY: <span className={profile.apyColor}>{profile.apy}</span>
                      </div>
                      <div className="font-medium text-foreground">
                        Leverage: {profile.leverage}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Continue Button - Removed since we auto-open the modal */}

            {/* Close Button */}
            <div className="flex justify-center mt-8">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedDepositType(null);
                  setSelectedRiskProfile(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Modal */}
      {selectedDepositType && selectedRiskProfile && selectedProfile && (
        <DepositModal
          key={`${selectedRiskProfile}-${selectedProfile.apy}`} // Force re-render when APY changes
          isOpen={isDepositModalOpen}
          onClose={() => {
            setIsDepositModalOpen(false);
            // Reset state to allow selecting a different profile
            setSelectedRiskProfile(null);
            setSelectedDepositType(null);
          }}
          riskProfile={selectedProfile}
        />
      )}

      {/* Footer */}
      {!selectedDepositType && <Footer />}
    </div>
  );
};

export default StackApp;

