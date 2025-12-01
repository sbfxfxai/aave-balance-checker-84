document.addEventListener('DOMContentLoaded', async () => {
    const connectBtn = document.getElementById('connect-btn');
    const refreshBtn = document.getElementById('refresh-positions');
    const depositBtn = document.getElementById('deposit-btn');
    const withdrawBtn = document.getElementById('withdraw-btn');
    
    let web3, sessionToken, userAddress;
    
    // Connect wallet
    connectBtn.addEventListener('click', async () => {
        const wallet = await initWalletConnect();
        if (!wallet) {
            alert('Failed to connect wallet');
            return;
        }
        
        web3 = wallet.web3;
        userAddress = wallet.address;
        sessionToken = await getSessionToken(wallet.address);
        
        document.getElementById('wallet-status').textContent = 
            `Connected: ${userAddress.substring(0,6)}...${userAddress.substring(38)}`;
        
        loadPositions();
    });
    
    // Refresh positions
    refreshBtn.addEventListener('click', loadPositions);
    
    // Load user positions
    async function loadPositions() {
        if (!sessionToken) return;
        
        try {
            const response = await fetch('/dashboard/positions?session_token=' + sessionToken);
            if (!response.ok) throw new Error('Failed to load positions');
            
            const positions = await response.json();
            renderPositions(positions);
        } catch (error) {
            console.error('Error loading positions:', error);
            alert('Failed to load positions');
        }
    }
    
    // Render positions
    function renderPositions(positions) {
        const container = document.getElementById('positions-container');
        container.innerHTML = `
            <div class="position-card">
                <div class="position-metric">
                    <div class="metric-value">${positions.supplied_usdc || 0}</div>
                    <div class="metric-label">USDC Supplied</div>
                </div>
                <div class="position-metric">
                    <div class="metric-value">${positions.borrowed_usdc || 0}</div>
                    <div class="metric-label">USDC Borrowed</div>
                </div>
                <div class="position-metric">
                    <div class="metric-value">${positions.health_factor || 'N/A'}</div>
                    <div class="metric-label">Health Factor</div>
                </div>
            </div>
        `;
    }
    
    // Deposit flow
    depositBtn.addEventListener('click', async () => {
        if (!sessionToken) {
            alert('Please connect wallet first');
            return;
        }
        
        const amount = document.getElementById('deposit-amount').value;
        if (!amount || amount <= 0) {
            alert('Please enter a valid AVAX amount');
            return;
        }
        
        // Execute deposit flow
        document.getElementById('deposit-status').textContent = 'Processing deposit...';
        try {
            const response = await fetch('/transactions/deposit', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    amount_avax: parseFloat(amount)
                })
            });
            
            if (!response.ok) throw new Error('Deposit request failed');
            
            const { transactions } = await response.json();
            await executeTransactions(transactions, "deposit-status");
            loadPositions();
        } catch (error) {
            console.error('Deposit failed:', error);
            document.getElementById('deposit-status').textContent = 
                `Error: ${error.message}`;
        }
    });
    
    // Withdraw flow
    withdrawBtn.addEventListener('click', async () => {
        if (!sessionToken) {
            alert('Please connect wallet first');
            return;
        }
        
        const amount = document.getElementById('withdraw-amount').value;
        if (!amount || amount <= 0) {
            alert('Please enter a valid USDC amount');
            return;
        }
        
        // Execute withdraw flow
        document.getElementById('withdraw-status').textContent = 'Processing withdrawal...';
        try {
            const response = await fetch('/transactions/withdraw', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    amount_usdc: parseFloat(amount)
                })
            });
            
            if (!response.ok) throw new Error('Withdraw request failed');
            
            const { transactions } = await response.json();
            await executeTransactions(transactions, "withdraw-status");
            loadPositions();
        } catch (error) {
            console.error('Withdraw failed:', error);
            document.getElementById('withdraw-status').textContent = 
                `Error: ${error.message}`;
        }
    });
    
    // Execute transactions
    async function executeTransactions(txs, statusElementId) {
        const statusElement = document.getElementById(statusElementId);
        
        try {
            for (const tx of txs) {
                statusElement.textContent = `Signing transaction...`;
                
                // Add gas estimation
                const gasEstimate = await web3.eth.estimateGas({
                    ...tx,
                    from: userAddress
                });
                
                // Add current gas price
                const gasPrice = await web3.eth.getGasPrice();
                
                const result = await web3.eth.sendTransaction({
                    ...tx,
                    from: userAddress,
                    gas: Math.floor(gasEstimate * 1.2),  // 20% buffer
                    gasPrice: Math.floor(gasPrice * 1.1)  // 10% buffer
                });
                
                statusElement.textContent = `Transaction mined: ${result.transactionHash.substring(0,20)}...`;
            }
            statusElement.textContent = 'All transactions completed successfully!';
        } catch (error) {
            console.error('Transaction failed:', error);
            statusElement.textContent = `Error: ${error.message}`;
        }
    }
});
