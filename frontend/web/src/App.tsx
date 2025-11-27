import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TradeData {
  id: string;
  name: string;
  encryptedAmount: string;
  price: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTradeData, setNewTradeData] = useState({ name: "", amount: "", price: "" });
  const [selectedTrade, setSelectedTrade] = useState<TradeData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tradesList: TradeData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tradesList.push({
            id: businessId,
            name: businessData.name,
            encryptedAmount: businessId,
            price: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTrades(tradesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createTrade = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrade(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating trade with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newTradeData.amount) || 0;
      const businessId = `trade-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTradeData.price) || 0,
        0,
        "Encrypted Trade"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trade created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTradeData({ name: "", amount: "", price: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrade(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Call failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTrades = trades.filter(trade => 
    trade.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trade.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedTrades = filteredTrades.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredTrades.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>mevShieldDEX 🔒</h1>
            <p>Anti-Front-Running DEX</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect Wallet to Access Encrypted Trading</h2>
            <p>Experience MEV-protected trading with FHE encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted trading system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>mevShieldDEX 🔒</h1>
          <p>Anti-Front-Running DEX</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Trade
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Trades</h3>
            <div className="stat-value">{trades.length}</div>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <div className="stat-value">{trades.filter(t => t.isVerified).length}</div>
          </div>
          <div className="stat-card">
            <h3>FHE Protected</h3>
            <div className="stat-value">100%</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search trades..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="trades-section">
          <h2>Encrypted Trades</h2>
          <div className="trades-list">
            {paginatedTrades.length === 0 ? (
              <div className="no-trades">
                <p>No trades found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Trade
                </button>
              </div>
            ) : (
              paginatedTrades.map((trade, index) => (
                <div 
                  className={`trade-item ${selectedTrade?.id === trade.id ? "selected" : ""}`}
                  key={index}
                  onClick={() => setSelectedTrade(trade)}
                >
                  <div className="trade-header">
                    <span className="trade-name">{trade.name}</span>
                    <span className={`trade-status ${trade.isVerified ? "verified" : "pending"}`}>
                      {trade.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <div className="trade-details">
                    <span>Price: ${trade.price}</span>
                    <span>Time: {new Date(trade.timestamp * 1000).toLocaleString()}</span>
                  </div>
                  <div className="trade-creator">
                    Creator: {trade.creator.substring(0, 6)}...{trade.creator.substring(38)}
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="info-panel">
          <h3>FHE Protection Process</h3>
          <div className="process-steps">
            <div className="step">
              <div className="step-number">1</div>
              <div className="step-content">
                <strong>Intent Encryption</strong>
                <p>Trade details encrypted before mempool entry</p>
              </div>
            </div>
            <div className="step">
              <div className="step-number">2</div>
              <div className="step-content">
                <strong>Blind Sequencing</strong>
                <p>Sequencer processes encrypted transactions</p>
              </div>
            </div>
            <div className="step">
              <div className="step-number">3</div>
              <div className="step-content">
                <strong>Secure Execution</strong>
                <p>Transactions executed with MEV protection</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create Encrypted Trade</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Trade Name</label>
                <input 
                  type="text" 
                  value={newTradeData.name}
                  onChange={(e) => setNewTradeData({...newTradeData, name: e.target.value})}
                  placeholder="Enter trade name..."
                />
              </div>
              
              <div className="form-group">
                <label>Amount (FHE Encrypted)</label>
                <input 
                  type="number" 
                  value={newTradeData.amount}
                  onChange={(e) => setNewTradeData({...newTradeData, amount: e.target.value})}
                  placeholder="Enter amount..."
                />
                <small>Integer only - Will be FHE encrypted</small>
              </div>
              
              <div className="form-group">
                <label>Price (Public)</label>
                <input 
                  type="number" 
                  value={newTradeData.price}
                  onChange={(e) => setNewTradeData({...newTradeData, price: e.target.value})}
                  placeholder="Enter price..."
                />
                <small>Public data - Not encrypted</small>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createTrade} 
                disabled={creatingTrade || isEncrypting}
                className="submit-btn"
              >
                {creatingTrade || isEncrypting ? "Encrypting..." : "Create Trade"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedTrade && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Trade Details</h2>
              <button onClick={() => setSelectedTrade(null)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="trade-info">
                <div className="info-row">
                  <span>Name:</span>
                  <strong>{selectedTrade.name}</strong>
                </div>
                <div className="info-row">
                  <span>Price:</span>
                  <strong>${selectedTrade.price}</strong>
                </div>
                <div className="info-row">
                  <span>Encrypted Amount:</span>
                  <strong>
                    {selectedTrade.isVerified ? 
                      `${selectedTrade.decryptedValue} (Verified)` : 
                      decryptedAmount !== null ? 
                      `${decryptedAmount} (Decrypted)` : 
                      "🔒 Encrypted"
                    }
                  </strong>
                </div>
              </div>
              
              <button 
                onClick={async () => {
                  const result = await decryptData(selectedTrade.id);
                  if (result !== null) setDecryptedAmount(result);
                }}
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "Decrypting..." : 
                 selectedTrade.isVerified ? "✅ Verified" : 
                 decryptedAmount !== null ? "🔄 Re-decrypt" : "🔓 Decrypt Amount"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;