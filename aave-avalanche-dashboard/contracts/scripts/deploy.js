const { ethers } = require("hardhat");
const fs = require("fs");
const readline = require("readline");

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

const SECURITY_CONFIG = {
  // Minimum balance multiplier (2x buffer for deployment + operations)
  MIN_BALANCE_MULTIPLIER: 2,
  
  // Maximum gas price (gwei) - cancel if gas is too high
  MAX_GAS_PRICE_GWEI: 50,
  
  // Expected chain ID (Avalanche mainnet)
  EXPECTED_CHAIN_ID: "43114",
  
  // Required environment variables
  REQUIRED_ENV_VARS: [
    "EXECUTOR_ADDRESS"
  ],
  
  // Recommended security features
  RECOMMENDATIONS: {
    MULTISIG_REQUIRED: true,
    MIN_SIGNERS: 3,
    TIMELOCK_DELAY: "24 hours",
    EMERGENCY_PAUSE: true
  }
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate environment variables and configuration
 */
function validateEnvironment() {
  console.log("🔍 Validating environment configuration...");
  
  // Check required environment variables
  const missing = SECURITY_CONFIG.REQUIRED_ENV_VARS.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  
  // Validate executor address
  const executorAddress = process.env.EXECUTOR_ADDRESS;
  
  if (!ethers.isAddress(executorAddress)) {
    throw new Error(`Invalid executor address format: ${executorAddress}`);
  }
  
  console.log("✅ Environment validation passed");
  return { executorAddress };
}

/**
 * Validate network configuration
 */
async function validateNetwork() {
  console.log("🌐 Validating network configuration...");
  
  const network = await ethers.provider.getNetwork();
  const currentChainId = network.chainId.toString();
  const expectedChainId = process.env.EXPECTED_CHAIN_ID || SECURITY_CONFIG.EXPECTED_CHAIN_ID;
  
  console.log(`Current network: ${network.name} (Chain ID: ${currentChainId})`);
  console.log(`Expected chain ID: ${expectedChainId}`);
  
  if (currentChainId !== expectedChainId) {
    console.error("❌ NETWORK MISMATCH DETECTED!");
    console.error(`   Expected: ${expectedChainId}`);
    console.error(`   Current:  ${currentChainId}`);
    
    if (process.env.FORCE_DEPLOY !== "true") {
      throw new Error("Deployment cancelled - wrong network. Set FORCE_DEPLOY=true to override.");
    }
    
    console.warn("⚠️  Proceeding anyway due to FORCE_DEPLOY=true");
  }
  
  // Warn if deploying to mainnet
  if (currentChainId === SECURITY_CONFIG.EXPECTED_CHAIN_ID) {
    console.warn("🚨 WARNING: Deploying to AVALANCHE MAINNET!");
    console.warn("   Double-check all parameters before proceeding.");
  }
  
  console.log("✅ Network validation passed");
  return network;
}

/**
 * Validate account balance and deployment costs
 */
async function validateBalance(deployer, executorAddress) {
  console.log("💰 Validating account balance...");
  
  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceInAvax = ethers.formatEther(balance);
  
  console.log(`Deployer address: ${deployer.address}`);
  console.log(`Account balance: ${balanceInAvax} AVAX`);
  
  // Estimate deployment cost
  const factory = await ethers.getContractFactory("TiltVaultManager");
  const deployTx = await factory.getDeployTransaction(executorAddress);
  const estimatedGas = await ethers.provider.estimateGas(deployTx);
  const feeData = await ethers.provider.getFeeData();
  const estimatedCost = estimatedGas * feeData.gasPrice;
  const estimatedCostInAvax = ethers.formatEther(estimatedCost);
  
  console.log(`Estimated deployment cost: ${estimatedCostInAvax} AVAX`);
  console.log(`Current gas price: ${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei`);
  
  // Check if balance is sufficient
  const requiredBalance = estimatedCost * BigInt(SECURITY_CONFIG.MIN_BALANCE_MULTIPLIER);
  
  if (balance < requiredBalance) {
    throw new Error(
      `Insufficient balance! Need at least ${ethers.formatEther(requiredBalance)} AVAX, ` +
      `have ${balanceInAvax} AVAX`
    );
  }
  
  // Check gas price
  const gasPriceGwei = parseFloat(ethers.formatUnits(feeData.gasPrice, "gwei"));
  if (gasPriceGwei > SECURITY_CONFIG.MAX_GAS_PRICE_GWEI) {
    console.warn(`⚠️  High gas price detected: ${gasPriceGwei} gwei (max: ${SECURITY_CONFIG.MAX_GAS_PRICE_GWEI} gwei)`);
    
    if (process.env.FORCE_DEPLOY !== "true") {
      throw new Error("Deployment cancelled - gas price too high. Set FORCE_DEPLOY=true to override.");
    }
    console.warn("⚠️  Proceeding anyway due to FORCE_DEPLOY=true");
  }
  
  console.log("✅ Balance validation passed");
  return { balance, estimatedCost };
}

/**
 * Validate executor address security
 */
async function validateExecutor(executorAddress, deployerAddress) {
  console.log("🔐 Validating executor security...");
  
  console.log(`Executor address: ${executorAddress}`);
  
  // Check if executor is zero address
  if (executorAddress === ethers.ZeroAddress) {
    throw new Error("Executor cannot be zero address");
  }
  
  // Check if executor is same as deployer (centralization risk)
  if (executorAddress.toLowerCase() === deployerAddress.toLowerCase()) {
    console.warn("⚠️  SECURITY WARNING: Executor is same as deployer!");
    console.warn("   This centralizes control and increases risk.");
    console.warn("   Consider using a multi-signature wallet instead.");
    
    if (process.env.REQUIRE_MULTISIG === "true") {
      throw new Error("Multi-sig executor required but not provided");
    }
  }
  
  // Check if executor is a contract (likely multi-sig)
  const executorCode = await ethers.provider.getCode(executorAddress);
  if (executorCode !== "0x") {
    console.log("✅ Executor is a contract (likely multi-sig)");
    
    // Try to detect if it's a Gnosis Safe
    if (executorCode.includes("0xa5E402")) {
      console.log("✅ Detected Gnosis Safe multi-sig");
    }
  } else {
    console.warn("⚠️  Executor is an EOA (not a multi-sig)");
    console.warn("   Consider using a multi-signature wallet for better security");
    
    if (SECURITY_CONFIG.RECOMMENDATIONS.MULTISIG_REQUIRED && process.env.REQUIRE_MULTISIG !== "false") {
      throw new Error("Multi-sig executor is required for production deployment");
    }
  }
  
  console.log("✅ Executor validation passed");
}

/**
 * Confirm deployment with user (for mainnet)
 */
async function confirmDeployment(network) {
  if (network.chainId.toString() !== SECURITY_CONFIG.EXPECTED_CHAIN_ID) {
    return true; // No confirmation needed for testnet
  }
  
  if (process.env.SKIP_CONFIRMATION === "true") {
    console.log("⚠️  Skipping confirmation due to SKIP_CONFIRMATION=true");
    return true;
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question("\n🚨 DEPLOYING TO AVALANCHE MAINNET 🚨\n" +
               "This will deploy a contract that controls user funds.\n" +
               "Double-check all parameters above.\n\n" +
               "Type 'yes' to confirm deployment: ", (answer) => {
      rl.close();
      const confirmed = answer.toLowerCase() === "yes";
      
      if (!confirmed) {
        console.log("❌ Deployment cancelled by user");
        process.exit(0);
      }
      
      resolve(true);
    });
  });
}

/**
 * Verify deployment after completion
 */
async function verifyDeployment(manager, executorAddress, contractAddress) {
  console.log("🔍 Verifying deployment...");
  
  try {
    // 1. Verify executor was set correctly
    const setExecutor = await manager.executor();
    if (setExecutor.toLowerCase() !== executorAddress.toLowerCase()) {
      throw new Error(
        `Executor mismatch! Expected ${executorAddress}, got ${setExecutor}`
      );
    }
    console.log("✅ Executor address verified");
    
    // 2. Verify contract code exists
    const code = await ethers.provider.getCode(contractAddress);
    if (code === "0x") {
      throw new Error("Contract deployment failed - no code at address");
    }
    console.log("✅ Contract code deployed");
    
    // 3. Check contract is not paused (if pause function exists)
    try {
      const isPaused = await manager.paused?.();
      console.log(`✅ Contract status: ${isPaused ? "PAUSED" : "ACTIVE"}`);
    } catch (e) {
      console.log("ℹ️  Could not check paused status (function may not exist)");
    }
    
    // 4. Test basic functionality
    try {
      const owner = await manager.owner();
      console.log(`✅ Contract owner: ${owner}`);
    } catch (e) {
      console.log("ℹ️  Could not check owner (function may not exist)");
    }
    
    console.log("✅ Deployment verification completed successfully");
    
  } catch (error) {
    console.error("❌ Deployment verification failed!");
    throw error;
  }
}

/**
 * Save deployment information with history
 */
function saveDeploymentInfo(deploymentInfo) {
  console.log("💾 Saving deployment information...");
  
  const deploymentFile = "./deployment.json";
  const historyFile = "./deployments-history.json";
  
  // Save current deployment
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`✅ Current deployment saved to ${deploymentFile}`);
  
  // Update history
  let history = [];
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
  }
  
  history.push(deploymentInfo);
  
  // Keep only last 10 deployments in history
  if (history.length > 10) {
    history = history.slice(-10);
  }
  
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  console.log(`✅ Deployment history saved to ${historyFile}`);
}

/**
 * Display post-deployment security checklist
 */
function displaySecurityChecklist(deploymentInfo) {
  console.log("\n🔒 POST-DEPLOYMENT SECURITY CHECKLIST:");
  console.log("=".repeat(60));
  
  const checklist = [
    "✅ Verify contract on Snowtrace block explorer",
    "⏳ Transfer ownership to multi-sig if not already",
    "🧪 Test deposit/withdrawal with small amount ($1-10)",
    "📊 Set up monitoring and alerting for contract events",
    "🔑 Secure and backup deployment keys",
    "📝 Document emergency procedures and response plan",
    "🛡️ Verify executor address is multi-sig wallet",
    "⏸️  Enable circuit breaker/pause mechanism if available",
    "🔄 Set up upgrade mechanism (if using proxy pattern)",
    "💰 Ensure sufficient balance in executor for operations"
  ];
  
  checklist.forEach((item, index) => {
    console.log(`${index + 1}. ${item}`);
  });
  
  console.log("\n📋 Verification Commands:");
  console.log(`npx hardhat verify --network avalanche ${deploymentInfo.contractAddress} ${deploymentInfo.executorAddress}`);
  
  console.log("\n🌐 Contract Links:");
  console.log(`Snowtrace: https://snowtrace.io/address/${deploymentInfo.contractAddress}`);
  
  if (deploymentInfo.executorAddress !== ethers.ZeroAddress) {
    console.log(`Executor: https://snowtrace.io/address/${deploymentInfo.executorAddress}`);
  }
}

// ============================================================================
// MAIN DEPLOYMENT FUNCTION
// ============================================================================

async function main() {
  console.log("🚀 TiltVaultManager Secure Deployment");
  console.log("=".repeat(60));
  
  try {
    // Dry run mode
    if (process.env.DRY_RUN === "true") {
      console.log("🔍 DRY RUN MODE - No actual deployment");
      
      const [deployer] = await ethers.getSigners();
      const network = await ethers.provider.getNetwork();
      const { executorAddress } = validateEnvironment();
      
      console.log("\n📋 Deployment Configuration:");
      console.log(`  Deployer: ${deployer.address}`);
      console.log(`  Executor: ${executorAddress}`);
      console.log(`  Network: ${network.name} (${network.chainId})`);
      console.log(`  Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} AVAX`);
      
      console.log("\n✅ Dry run completed - no actual deployment");
      return;
    }
    
    // Step 1: Get deployer
    const [deployer] = await ethers.getSigners();
    console.log(`Deployer address: ${deployer.address}`);
    console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());
    
    // Step 2: Validate environment
    const { executorAddress } = validateEnvironment();
    
    // Step 3: Validate network
    const network = await validateNetwork();
    
    // Step 4: Validate balance
    await validateBalance(deployer, executorAddress);
    
    // Step 5: Validate executor security
    await validateExecutor(executorAddress, deployer.address);
    
    // Step 6: Confirm deployment (mainnet only)
    await confirmDeployment(network);
    
    // Step 7: Deploy contract
    console.log("\n🔨 Deploying TiltVaultManager...");
    console.log(`Executor: ${executorAddress}`);

    // Deploy the contract
    const TiltVaultManager = await ethers.getContractFactory("TiltVaultManager");
    const manager = await TiltVaultManager.deploy(executorAddress);

    await manager.waitForDeployment();
    const contractAddress = await manager.getAddress();

    console.log("TiltVaultManager deployed to:", contractAddress);
    console.log("");
    
    // Step 8: Verify deployment
    await verifyDeployment(manager, executorAddress, contractAddress);
    
    // Step 9: Prepare deployment info
    const deploymentInfo = {
      contractAddress,
      executorAddress,
      deployedAt: new Date().toISOString(),
      network: {
        name: network.name,
        chainId: network.chainId.toString()
      },
      deployer: deployer.address,
      deploymentTx: manager.deploymentTransaction().hash,
      gasUsed: (await manager.deploymentTransaction().wait()).gasUsed.toString(),
      security: {
        multisigRequired: SECURITY_CONFIG.RECOMMENDATIONS.MULTISIG_REQUIRED,
        executorIsContract: (await ethers.provider.getCode(executorAddress)) !== "0x",
        verified: true
      }
    };
    
    // Step 10: Save deployment info
    saveDeploymentInfo(deploymentInfo);
    
    // Step 11: Display results and checklist
    console.log("=".repeat(60));
    console.log("DEPLOYMENT COMPLETE");
    console.log("=".repeat(60));
    console.log("");
    console.log("Contract Address:", contractAddress);
    console.log("Executor Address:", executorAddress);
    console.log("Network:", (await ethers.provider.getNetwork()).name);
    console.log("");
    console.log("Next steps:");
    console.log("1. Verify the contract on Snowtrace:");
    console.log(`   npx hardhat verify --network avalanche ${contractAddress} ${executorAddress}`);
    console.log("");
    console.log("2. Update the frontend with the contract address");
    console.log("3. Update the backend API to use the contract");
    console.log("");
    
    displaySecurityChecklist(deploymentInfo);
    
    console.log("\n🔐 Security Status:");
    console.log(`  Multi-sig executor: ${deploymentInfo.security.executorIsContract ? "✅" : "⚠️ "}`);
    console.log(`  Deployment verified: ${deploymentInfo.security.verified ? "✅" : "❌"}`);
    
    if (!deploymentInfo.security.executorIsContract) {
      console.warn("\n⚠️  SECURITY WARNING: Executor is not a multi-sig!");
      console.warn("   Consider upgrading to a multi-signature wallet for better security.");
    }
    
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED");
    console.error("=".repeat(60));
    console.error("Error:", error.message);
    
    if (error.code) {
      console.error("Error code:", error.code);
    }
    
    if (error.transaction) {
      console.error("Transaction:", JSON.stringify(error.transaction, null, 2));
    }
    
    console.error("\nFull error details:");
    console.error(error);
    
    process.exit(1);
  }
}

// ============================================================================
// EXECUTION
// ============================================================================

main()
  .then(() => {
    console.log("\n✅ Deployment script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment script failed");
    process.exit(1);
  });
