// Initialize WalletConnect
async function initWalletConnect() {
    try {
        const provider = new WalletConnectProvider.default({
            rpc: { 
                43114: "https://api.avax.network/ext/bc/C/rpc" 
            },
            chainId: 43114
        });
        
        await provider.enable();
        const web3 = new Web3(provider);
        const accounts = await web3.eth.getAccounts();
        
        return {
            web3,
            address: accounts[0],
            provider
        };
    } catch (error) {
        console.error("Wallet connection failed:", error);
        return null;
    }
}

// Get session token from backend
async function getSessionToken(address) {
    const response = await fetch('/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
    });
    
    if (!response.ok) {
        throw new Error('Failed to get session token');
    }
    
    const data = await response.json();
    return data.session_token;
}
