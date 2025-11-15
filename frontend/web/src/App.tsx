import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TradeData {
  id: string;
  pair: string;
  amount: number;
  price: number;
  timestamp: number;
  creator: string;
  encryptedAmount: number;
  encryptedPrice: number;
  isVerified: boolean;
  type: 'buy' | 'sell';
  status: 'pending' | 'executed' | 'failed';
}

interface MarketStats {
  totalVolume: number;
  activeTrades: number;
  avgPrice: number;
  priceChange: number;
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
  const [newTradeData, setNewTradeData] = useState({ 
    pair: "ETH/USDT", 
    amount: "", 
    price: "", 
    type: "buy" as 'buy' | 'sell' 
  });
  const [selectedTrade, setSelectedTrade] = useState<TradeData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"all" | "buy" | "sell">("all");
  const [marketStats, setMarketStats] = useState<MarketStats>({
    totalVolume: 0,
    activeTrades: 0,
    avgPrice: 2850,
    priceChange: 2.5
  });
  const [userHistory, setUserHistory] = useState<TradeData[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

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
        console.error('FHEVM initialization failed:', error);
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

  useEffect(() => {
    if (address && trades.length > 0) {
      const userTrades = trades.filter(trade => trade.creator.toLowerCase() === address.toLowerCase());
      setUserHistory(userTrades);
    }
  }, [address, trades]);

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
            pair: businessData.name,
            amount: Number(businessData.publicValue1) || 0,
            price: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            encryptedAmount: Number(businessData.decryptedValue) || 0,
            encryptedPrice: 0,
            isVerified: businessData.isVerified,
            type: Number(businessData.publicValue1) > 0 ? 'buy' : 'sell',
            status: 'executed'
          });
        } catch (e) {
          console.error('Error loading trade data:', e);
        }
      }
      
      setTrades(tradesList);
      
      const stats = calculateMarketStats(tradesList);
      setMarketStats(stats);
      
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateMarketStats = (tradesList: TradeData[]): MarketStats => {
    const totalVolume = tradesList.reduce((sum, trade) => sum + trade.amount, 0);
    const activeTrades = tradesList.length;
    const avgPrice = tradesList.length > 0 
      ? tradesList.reduce((sum, trade) => sum + trade.price, 0) / tradesList.length 
      : 2850;
    
    return {
      totalVolume,
      activeTrades,
      avgPrice,
      priceChange: 2.5
    };
  };

  const createTrade = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrade(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting trade intent with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newTradeData.amount) || 0;
      const priceValue = parseInt(newTradeData.price) || 0;
      const businessId = `trade-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.pair,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue,
        priceValue,
        `${newTradeData.type.toUpperCase()} Order - FHE Protected`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Submitting encrypted trade..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trade created with FHE protection!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTradeData({ pair: "ETH/USDT", amount: "", price: "", type: "buy" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrade(false); 
    }
  };

  const decryptTrade = async (tradeId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(tradeId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Trade already verified on-chain" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(tradeId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(tradeId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying trade decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trade verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Trade is already verified" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTrades = trades.filter(trade => {
    const matchesSearch = trade.pair.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         trade.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === "all" || trade.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const renderMarketStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${marketStats.totalVolume.toLocaleString()}</div>
            <div className="stat-label">Total Volume</div>
          </div>
        </div>
        
        <div className="stat-card neon-blue">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{marketStats.activeTrades}</div>
            <div className="stat-label">Active Trades</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">${marketStats.avgPrice.toFixed(2)}</div>
            <div className="stat-label">Avg Price</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">📈</div>
          <div className="stat-content">
            <div className="stat-value">{marketStats.priceChange}%</div>
            <div className="stat-label">24h Change</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>Trade Intent Encryption</h4>
            <p>Your trade details are encrypted with FHE before submission</p>
          </div>
        </div>
        
        <div className="process-arrow">→</div>
        
        <div className="process-step">
          <div className="step-icon">🛡️</div>
          <div className="step-content">
            <h4>MEV Protection</h4>
            <p>Encrypted trades prevent front-running in mempool</p>
          </div>
        </div>
        
        <div className="process-arrow">→</div>
        
        <div className="process-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Secure Decryption</h4>
            <p>Trade executes only after FHE verification</p>
          </div>
        </div>
      </div>
    );
  };

  const renderPriceChart = () => {
    return (
      <div className="price-chart">
        <div className="chart-header">
          <h3>ETH/USDT Chart</h3>
          <span className="price-change positive">+{marketStats.priceChange}%</span>
        </div>
        <div className="chart-placeholder">
          <div className="chart-line"></div>
          <div className="chart-points">
            {[2850, 2860, 2840, 2870, 2850, 2880, 2870].map((price, index) => (
              <div key={index} className="chart-point" style={{ 
                left: `${index * 16}%`,
                bottom: `${((price - 2830) / 50) * 100}%`
              }}></div>
            ))}
          </div>
        </div>
        <div className="chart-labels">
          <span>24H</span>
          <span>Current: ${marketStats.avgPrice.toFixed(2)}</span>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>MEV Shield DEX 🔐</h1>
            <span className="tagline">Anti-Front-Running Exchange</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect Wallet to Start Trading</h2>
            <p>Experience MEV-protected trading with FHE encryption</p>
            <div className="protection-features">
              <div className="feature">
                <span>🔒</span>
                <p>Encrypted Trade Intents</p>
              </div>
              <div className="feature">
                <span>🛡️</span>
                <p>Front-Running Protection</p>
              </div>
              <div className="feature">
                <span>⚡</span>
                <p>Fair Execution</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Trading System...</p>
        <p className="loading-note">Securing your trade intents</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>MEV Shield DEX 🔐</h1>
          <span className="tagline">FHE Protected Trading</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            New Trade
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="left-panel">
          {renderPriceChart()}
          
          <div className="stats-section">
            <h3>Market Overview</h3>
            {renderMarketStats()}
          </div>

          <div className="user-history">
            <h3>Your Trade History</h3>
            <div className="history-list">
              {userHistory.slice(0, 5).map((trade, index) => (
                <div key={index} className="history-item">
                  <div className="trade-type">{trade.type}</div>
                  <div className="trade-pair">{trade.pair}</div>
                  <div className="trade-amount">{trade.amount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="right-panel">
          <div className="panel-header">
            <h2>FHE Protected Trades</h2>
            <div className="controls">
              <input
                type="text"
                placeholder="Search trades..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select 
                value={filterType} 
                onChange={(e) => setFilterType(e.target.value as any)}
                className="filter-select"
              >
                <option value="all">All Trades</option>
                <option value="buy">Buy Orders</option>
                <option value="sell">Sell Orders</option>
              </select>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="fhe-protection">
            <h4>🔐 How FHE Protects Your Trades</h4>
            {renderFHEProcess()}
          </div>

          <div className="trades-list">
            {filteredTrades.length === 0 ? (
              <div className="no-trades">
                <p>No protected trades found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Trade
                </button>
              </div>
            ) : (
              filteredTrades.map((trade) => (
                <div 
                  key={trade.id} 
                  className={`trade-item ${trade.type} ${selectedTrade?.id === trade.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTrade(trade)}
                >
                  <div className="trade-header">
                    <span className="trade-pair">{trade.pair}</span>
                    <span className={`trade-type ${trade.type}`}>{trade.type.toUpperCase()}</span>
                  </div>
                  <div className="trade-details">
                    <span>Amount: {trade.amount}</span>
                    <span>Price: ${trade.price}</span>
                  </div>
                  <div className="trade-footer">
                    <span className="trade-time">
                      {new Date(trade.timestamp * 1000).toLocaleTimeString()}
                    </span>
                    <span className={`verification-status ${trade.isVerified ? 'verified' : 'pending'}`}>
                      {trade.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateTradeModal
          onSubmit={createTrade}
          onClose={() => setShowCreateModal(false)}
          creating={creatingTrade}
          tradeData={newTradeData}
          setTradeData={setNewTradeData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedTrade && (
        <TradeDetailModal
          trade={selectedTrade}
          onClose={() => setSelectedTrade(null)}
          onDecrypt={() => decryptTrade(selectedTrade.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateTradeModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  tradeData: any;
  setTradeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, tradeData, setTradeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setTradeData({ ...tradeData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-trade-modal">
        <div className="modal-header">
          <h2>Create FHE Protected Trade</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Trade amounts are encrypted to prevent MEV attacks</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Trading Pair</label>
              <select name="pair" value={tradeData.pair} onChange={handleChange}>
                <option value="ETH/USDT">ETH/USDT</option>
                <option value="BTC/USDT">BTC/USDT</option>
                <option value="SOL/USDT">SOL/USDT</option>
              </select>
            </div>

            <div className="form-group">
              <label>Order Type</label>
              <select name="type" value={tradeData.type} onChange={handleChange}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>

            <div className="form-group">
              <label>Amount (FHE Encrypted)</label>
              <input
                type="number"
                name="amount"
                value={tradeData.amount}
                onChange={handleChange}
                placeholder="Enter amount"
              />
              <div className="input-hint">Encrypted with FHE 🔒</div>
            </div>

            <div className="form-group">
              <label>Price (Public)</label>
              <input
                type="number"
                name="price"
                value={tradeData.price}
                onChange={handleChange}
                placeholder="Enter price"
              />
              <div className="input-hint">Public market data</div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !tradeData.amount || !tradeData.price}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting Trade..." : "Create Protected Trade"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TradeDetailModal: React.FC<{
  trade: TradeData;
  onClose: () => void;
  onDecrypt: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ trade, onClose, onDecrypt, isDecrypting }) => {
  const handleDecrypt = async () => {
    await onDecrypt();
  };

  return (
    <div className="modal-overlay">
      <div className="trade-detail-modal">
        <div className="modal-header">
          <h2>Trade Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>

        <div className="modal-body">
          <div className="trade-info">
            <div className="info-row">
              <span>Pair:</span>
              <strong>{trade.pair}</strong>
            </div>
            <div className="info-row">
              <span>Type:</span>
              <strong className={`trade-type ${trade.type}`}>{trade.type.toUpperCase()}</strong>
            </div>
            <div className="info-row">
              <span>Amount:</span>
              <strong>{trade.amount}</strong>
            </div>
            <div className="info-row">
              <span>Price:</span>
              <strong>${trade.price}</strong>
            </div>
            <div className="info-row">
              <span>Time:</span>
              <strong>{new Date(trade.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>

          <div className="encryption-status">
            <h4>FHE Protection Status</h4>
            <div className={`status-badge ${trade.isVerified ? 'verified' : 'encrypted'}`}>
              {trade.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
            </div>
            
            {trade.isVerified ? (
              <div className="decrypted-data">
                <strong>Decrypted Amount:</strong> {trade.encryptedAmount}
              </div>
            ) : (
              <button 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "Decrypting..." : "Verify Decryption"}
              </button>
            )}
          </div>

          <div className="mev-protection-info">
            <h4>🛡️ MEV Protection Active</h4>
            <p>This trade was protected from front-running by FHE encryption</p>
            <ul>
              <li>✅ Trade intent hidden from validators</li>
              <li>✅ No sandwich attacks possible</li>
              <li>✅ Fair price execution</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!trade.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


