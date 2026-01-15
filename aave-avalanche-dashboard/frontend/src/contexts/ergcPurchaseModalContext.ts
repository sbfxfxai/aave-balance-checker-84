import { createContext } from 'react';

export interface ErgcPurchaseModalContextType {
  openModal: () => void;
  closeModal: () => void;
  isOpen: boolean;
}

export const ErgcPurchaseModalContext = createContext<ErgcPurchaseModalContextType | undefined>(undefined);
