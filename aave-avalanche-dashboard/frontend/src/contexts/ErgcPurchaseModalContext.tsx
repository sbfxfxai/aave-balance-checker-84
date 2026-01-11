import React, { createContext, useContext, useState, useCallback, ReactNode, Suspense, lazy } from 'react';

// Lazy load the modal component to avoid loading wagmi hooks until it's actually needed
const ErgcPurchaseModal = lazy(() => import('@/components/ErgcPurchaseModal').then(m => ({ default: m.ErgcPurchaseModal })));

interface ErgcPurchaseModalContextType {
  openModal: () => void;
  closeModal: () => void;
  isOpen: boolean;
}

const ErgcPurchaseModalContext = createContext<ErgcPurchaseModalContextType | undefined>(undefined);

// Minimal fallback for modal loading
const ModalFallback = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
    <div className="animate-pulse bg-muted h-10 w-32 rounded-md" />
  </div>
);

export function ErgcPurchaseModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <ErgcPurchaseModalContext.Provider value={{ openModal, closeModal, isOpen }}>
      {children}
      {isOpen && (
        <Suspense fallback={<ModalFallback />}>
          <ErgcPurchaseModal isOpen={isOpen} onClose={closeModal} />
        </Suspense>
      )}
    </ErgcPurchaseModalContext.Provider>
  );
}

export function useErgcPurchaseModal() {
  const context = useContext(ErgcPurchaseModalContext);
  if (context === undefined) {
    throw new Error('useErgcPurchaseModal must be used within ErgcPurchaseModalProvider');
  }
  return context;
}

