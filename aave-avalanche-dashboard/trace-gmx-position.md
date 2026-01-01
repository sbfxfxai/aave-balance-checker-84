# GMX Position Tracing Guide

## Overview

This document provides a comprehensive guide for tracing and monitoring GMX positions within the TiltVault platform, ensuring transparency and accountability for all trading activities.

## Position Identification

### Position ID Structure
Each GMX position has a unique identifier composed of:
- **Market**: Trading pair (e.g., BTC/USD)
- **Collateral Token**: Token used as collateral
- **Index Token**: Token being traded
- **Is Long**: Direction of position
- **Account**: User's wallet address

### Position Tracking
```javascript
const positionKey = `${market}_${collateralToken}_${indexToken}_${isLong}_${account}`;
```

## Tracing Methods

### 1. On-Chain Tracing

#### Transaction Hash Tracking
Every GMX transaction creates a traceable record:
```javascript
const txHash = "0x1234567890abcdef..."; // From transaction receipt
const positionKey = await getPositionKeyFromTransaction(txHash);
```

#### Event-Based Tracing
GMX contracts emit events for position changes:
```javascript
// Listen for PositionUpdated events
contract.on("PositionUpdated", (event) => {
  const position = {
    key: event.args.key,
    size: event.args.size,
    collateral: event.args.collateral,
    averagePrice: event.args.averagePrice,
    entryPrice: event.args.entryPrice,
    realisedPnl: event.args.realisedPnl
  };
  tracePosition(position);
});
```

### 2. Database Tracing

#### Position Records
```sql
CREATE TABLE gmx_positions (
  id VARCHAR(255) PRIMARY KEY,
  user_address VARCHAR(42) NOT NULL,
  market VARCHAR(50) NOT NULL,
  collateral_token VARCHAR(42) NOT NULL,
  index_token VARCHAR(42) NOT NULL,
  is_long BOOLEAN NOT NULL,
  size DECIMAL(36, 18) NOT NULL,
  collateral DECIMAL(36, 18) NOT NULL,
  average_price DECIMAL(36, 18) NOT NULL,
  entry_price DECIMAL(36, 18) NOT NULL,
  realised_pnl DECIMAL(36, 18) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  transaction_hash VARCHAR(66),
  INDEX idx_user_address (user_address),
  INDEX idx_market (market),
  INDEX idx_created_at (created_at)
);
```

#### Position History
```sql
CREATE TABLE gmx_position_history (
  id SERIAL PRIMARY KEY,
  position_id VARCHAR(255) NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'create', 'increase', 'decrease', 'close'
  size_before DECIMAL(36, 18),
  size_after DECIMAL(36, 18),
  collateral_before DECIMAL(36, 18),
  collateral_after DECIMAL(36, 18),
  price DECIMAL(36, 18),
  realised_pnl DECIMAL(36, 18),
  transaction_hash VARCHAR(66),
  block_number BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES gmx_positions(id)
);
```

### 3. API Tracing

#### Position Creation API
```javascript
// POST /api/positions/create
app.post('/api/positions/create', async (req, res) => {
  const { strategy, market, size, isLong, leverage } = req.body;
  
  // Create position in GMX
  const txResult = await gmxRouter.createOrder(params);
  
  // Trace the position
  const positionTrace = {
    userAddress: req.user.address,
    strategy,
    market,
    size,
    isLong,
    leverage,
    transactionHash: txResult.hash,
    blockNumber: txResult.blockNumber,
    gasUsed: txResult.gasUsed,
    timestamp: new Date().toISOString()
  };
  
  // Store trace
  await storePositionTrace(positionTrace);
  
  res.json({ success: true, positionId: positionTrace.positionId });
});
```

## Real-Time Monitoring

### WebSocket Monitoring
```javascript
// WebSocket connection for real-time updates
const ws = new WebSocket('wss://api.tiltvault.com/positions');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'position_update') {
    updatePositionDisplay(data.position);
    logPositionChange(data.position);
  }
});
```

### Position Status Updates
```javascript
function updatePositionStatus(positionId, status, details) {
  const update = {
    positionId,
    status, // 'opening', 'open', 'closing', 'closed'
    details,
    timestamp: new Date().toISOString()
  };
  
  // Update database
  await db.positions.update({ id: positionId }, update);
  
  // Send real-time notification
  websocket.clients.forEach(client => {
    if (client.subscribedPositions.includes(positionId)) {
      client.send(JSON.stringify({
        type: 'position_update',
        position: update
      }));
    }
  });
}
```

## Audit Trail

### Transaction Audit
```javascript
class PositionAuditor {
  async auditTransaction(txHash, userAddress) {
    const tx = await provider.getTransaction(txHash);
    const receipt = await provider.getTransactionReceipt(txHash);
    
    const audit = {
      txHash,
      userAddress,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: tx.gasPrice.toString(),
      timestamp: new Date(receipt.timestamp * 1000).toISOString(),
      method: tx.data.slice(0, 10), // Function selector
      value: ethers.utils.formatEther(tx.value),
      success: receipt.status === 1
    };
    
    await storeAuditRecord(audit);
    return audit;
  }
}
```

### Compliance Reporting
```javascript
function generateComplianceReport(userAddress, startDate, endDate) {
  const positions = await db.positions.findAll({
    where: {
      userAddress,
      createdAt: {
        [Op.between]: [startDate, endDate]
      }
    },
    include: [{
      model: PositionHistory,
      as: 'history'
    }]
  });
  
  const report = {
    userAddress,
    period: { startDate, endDate },
    totalPositions: positions.length,
    totalVolume: calculateTotalVolume(positions),
    totalPnL: calculateTotalPnL(positions),
    positions: positions.map(formatPositionForReport)
  };
  
  return report;
}
```

## Error Handling & Recovery

### Position Recovery
```javascript
async function recoverPosition(positionId) {
  try {
    // Query GMX for current position state
    const currentPosition = await gmxReader.getPosition(positionId);
    
    if (!currentPosition) {
      throw new Error('Position not found in GMX');
    }
    
    // Update local database
    await db.positions.update(
      { 
        size: currentPosition.size,
        collateral: currentPosition.collateral,
        averagePrice: currentPosition.averagePrice,
        realisedPnl: currentPosition.realisedPnl
      },
      { where: { id: positionId } }
    );
    
    return currentPosition;
    
  } catch (error) {
    console.error('Error recovering position:', error);
    throw error;
  }
}
```

### Discrepancy Detection
```javascript
async function detectDiscrepancies() {
  const localPositions = await db.positions.findAll();
  const discrepancies = [];
  
  for (const localPos of localPositions) {
    try {
      const gmxPos = await gmxReader.getPosition(localPos.id);
      
      if (gmxPos) {
        const sizeDiff = Math.abs(gmxPos.size - localPos.size);
        const pnlDiff = Math.abs(gmxPos.realisedPnl - localPos.realisedPnl);
        
        if (sizeDiff > 0.01 || pnlDiff > 0.01) {
          discrepancies.push({
            positionId: localPos.id,
            localSize: localPos.size,
            gmxSize: gmxPos.size,
            localPnL: localPos.realisedPnl,
            gmxPnL: gmxPos.realisedPnl,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      discrepancies.push({
        positionId: localPos.id,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return discrepancies;
}
```

## Performance Monitoring

### Position Metrics
```javascript
class PositionMetrics {
  static async calculateMetrics(positionId) {
    const history = await db.positionHistory.findAll({
      where: { positionId },
      order: [['createdAt', 'ASC']]
    });
    
    if (history.length === 0) {
      return null;
    }
    
    const metrics = {
      positionId,
      duration: this.calculateDuration(history),
      totalGasUsed: history.reduce((sum, h) => sum + parseFloat(h.gasUsed || 0), 0),
      totalFees: this.calculateTotalFees(history),
      maxDrawdown: this.calculateMaxDrawdown(history),
      sharpeRatio: this.calculateSharpeRatio(history),
      winRate: this.calculateWinRate(history)
    };
    
    return metrics;
  }
  
  static calculateDuration(history) {
    const start = new Date(history[0].createdAt);
    const end = new Date(history[history.length - 1].createdAt);
    return (end - start) / (1000 * 60 * 60); // Hours
  }
  
  static calculateMaxDrawdown(history) {
    let maxDrawdown = 0;
    let peak = 0;
    
    for (const record of history) {
      const pnl = parseFloat(record.realisedPnl || 0);
      
      if (pnl > peak) {
        peak = pnl;
      }
      
      const drawdown = peak - pnl;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }
}
```

## User Interface

### Position Dashboard
```javascript
function PositionDashboard({ positionId }) {
  const [position, setPosition] = useState(null);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState(null);
  
  useEffect(() => {
    // Load position data
    loadPosition(positionId);
    
    // Subscribe to real-time updates
    const ws = new WebSocket(`wss://api.tiltvault.com/positions/${positionId}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'position_update') {
        setPosition(data.position);
        setMetrics(data.metrics);
      } else if (data.type === 'history_update') {
        setHistory(prev => [...prev, data.history]);
      }
    };
    
    return () => ws.close();
  }, [positionId]);
  
  return (
    <div className="position-dashboard">
      <PositionHeader position={position} />
      <PositionMetrics metrics={metrics} />
      <PositionChart history={history} />
      <PositionActions position={position} />
    </div>
  );
}
```

## Security Considerations

### Access Control
```javascript
function canAccessPosition(userAddress, positionId, userRole) {
  // Users can only access their own positions
  if (userRole === 'user') {
    const position = await db.positions.findOne({ 
      where: { id: positionId, userAddress } 
    });
    return !!position;
  }
  
  // Admins can access all positions
  if (userRole === 'admin') {
    return true;
  }
  
  return false;
}
```

### Data Privacy
```javascript
function sanitizePositionData(position, userRole) {
  const sanitized = { ...position };
  
  // Remove sensitive data for non-admin users
  if (userRole !== 'admin') {
    delete sanitized.privateKey;
    delete sanitized.seedPhrase;
    delete sanitized.internalNotes;
  }
  
  return sanitized;
}
```

## Troubleshooting

### Common Issues

#### Position Not Found
```bash
# Check if position exists in GMX
node scripts/check-position.js <position_id>

# Verify database record
node scripts/verify-position-db.js <position_id>
```

#### Discrepancy Between Systems
```bash
# Run discrepancy detection
node scripts/detect-discrepancies.js

# Sync positions from GMX
node scripts/sync-positions.js
```

#### Performance Issues
```bash
# Check position metrics
node scripts/analyze-position-performance.js <position_id>

# Optimize database queries
node scripts/optimize-position-queries.js
```

## Conclusion

Position tracing in TiltVault provides comprehensive visibility into all trading activities, ensuring transparency, accountability, and regulatory compliance. The multi-layered approach combines on-chain data, database records, and real-time monitoring to create a complete audit trail for every position.

### Key Benefits
- ✅ Complete transaction traceability
- ✅ Real-time position monitoring
- ✅ Comprehensive audit trails
- ✅ Performance analytics
- ✅ Regulatory compliance
- ✅ User privacy protection

### Next Steps
1. Implement automated monitoring alerts
2. Set up regular discrepancy detection
3. Create user-friendly position dashboards
4. Establish compliance reporting workflows
5. Implement position analytics and insights

---
*Position tracing guide completed and approved on November 22, 2024*
