// Position storage - in-memory only (serverless functions are stateless, so this is per-invocation)
// For production persistence, positions are tracked via blockchain state

export interface UserPosition {
  id: string;
  paymentId: string;
  userEmail: string;
  strategyType: 'conservative' | 'balanced' | 'aggressive';
  usdcAmount: number;
  status: 'pending' | 'executing' | 'active' | 'closed' | 'failed';
  
  // AAVE position details
  aaveSupplyAmount?: number;
  aaveSupplyTxHash?: string;
  
  // GMX position details
  gmxCollateralAmount?: number;
  gmxPositionSize?: number;
  gmxLeverage?: number;
  gmxEntryPrice?: number;
  gmxOrderTxHash?: string;
  gmxPositionKey?: string;
  
  // Timestamps
  createdAt: string;
  executedAt?: string;
  closedAt?: string;
  
  // Error tracking
  error?: string;
}

// In-memory store
const positions = new Map<string, UserPosition>();
const positionsByEmail = new Map<string, string[]>();

export async function savePosition(position: UserPosition): Promise<void> {
  positions.set(position.id, position);
  
  const email = position.userEmail.toLowerCase();
  const ids = positionsByEmail.get(email) || [];
  if (!ids.includes(position.id)) {
    ids.push(position.id);
    positionsByEmail.set(email, ids);
  }
}

export async function getPosition(id: string): Promise<UserPosition | null> {
  return positions.get(id) || null;
}

export async function getPositionsByEmail(email: string): Promise<UserPosition[]> {
  const normalizedEmail = email.toLowerCase();
  const ids = positionsByEmail.get(normalizedEmail) || [];
  return ids.map(id => positions.get(id)).filter(Boolean) as UserPosition[];
}

export async function updatePosition(id: string, updates: Partial<UserPosition>): Promise<UserPosition | null> {
  const existing = await getPosition(id);
  if (!existing) return null;
  
  const updated = { ...existing, ...updates };
  await savePosition(updated);
  return updated;
}

export async function getAllPositions(): Promise<UserPosition[]> {
  return Array.from(positions.values());
}

export function generatePositionId(): string {
  return `pos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
