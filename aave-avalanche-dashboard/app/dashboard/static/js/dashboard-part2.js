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
