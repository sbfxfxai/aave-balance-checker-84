import { useContext } from 'react';
import { ErgcPurchaseModalContext } from './ergcPurchaseModalContext';

export const useErgcPurchaseModal = () => {
  const context = useContext(ErgcPurchaseModalContext);
  if (context === undefined) {
    throw new Error('useErgcPurchaseModal must be used within an ErgcPurchaseModalProvider');
  }
  return context;
};
