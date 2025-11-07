pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract mevShieldDex is ZamaEthereumConfig {
    
    struct Order {
        address trader;
        euint32 encryptedAmount;
        euint32 encryptedPrice;
        uint256 publicNonce;
        uint256 blockNumber;
        bool executed;
        uint32 decryptedAmount;
        uint32 decryptedPrice;
    }
    
    mapping(bytes32 => Order) public orders;
    bytes32[] public orderIds;
    
    event OrderCreated(bytes32 indexed orderId, address indexed trader);
    event OrderExecuted(bytes32 indexed orderId, uint32 amount, uint32 price);
    
    constructor() ZamaEthereumConfig() {}
    
    function createOrder(
        externalEuint32 encryptedAmount,
        externalEuint32 encryptedPrice,
        bytes calldata amountProof,
        bytes calldata priceProof,
        uint256 publicNonce
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, amountProof)), "Invalid amount encryption");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPrice, priceProof)), "Invalid price encryption");
        
        bytes32 orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp, publicNonce));
        require(orders[orderId].trader == address(0), "Order already exists");
        
        orders[orderId] = Order({
            trader: msg.sender,
            encryptedAmount: FHE.fromExternal(encryptedAmount, amountProof),
            encryptedPrice: FHE.fromExternal(encryptedPrice, priceProof),
            publicNonce: publicNonce,
            blockNumber: block.number,
            executed: false,
            decryptedAmount: 0,
            decryptedPrice: 0
        });
        
        FHE.allowThis(orders[orderId].encryptedAmount);
        FHE.allowThis(orders[orderId].encryptedPrice);
        
        FHE.makePubliclyDecryptable(orders[orderId].encryptedAmount);
        FHE.makePubliclyDecryptable(orders[orderId].encryptedPrice);
        
        orderIds.push(orderId);
        emit OrderCreated(orderId, msg.sender);
    }
    
    function executeOrder(
        bytes32 orderId,
        bytes memory amountProof,
        bytes memory priceProof
    ) external {
        require(orders[orderId].trader != address(0), "Order does not exist");
        require(!orders[orderId].executed, "Order already executed");
        
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(orders[orderId].encryptedAmount);
        cts[1] = FHE.toBytes32(orders[orderId].encryptedPrice);
        
        bytes memory abiEncodedAmount = abi.encode(orders[orderId].decryptedAmount);
        bytes memory abiEncodedPrice = abi.encode(orders[orderId].decryptedPrice);
        
        FHE.checkSignatures(cts, abiEncodedAmount, amountProof);
        FHE.checkSignatures(cts, abiEncodedPrice, priceProof);
        
        orders[orderId].executed = true;
        emit OrderExecuted(orderId, orders[orderId].decryptedAmount, orders[orderId].decryptedPrice);
    }
    
    function getEncryptedAmount(bytes32 orderId) external view returns (euint32) {
        require(orders[orderId].trader != address(0), "Order does not exist");
        return orders[orderId].encryptedAmount;
    }
    
    function getEncryptedPrice(bytes32 orderId) external view returns (euint32) {
        require(orders[orderId].trader != address(0), "Order does not exist");
        return orders[orderId].encryptedPrice;
    }
    
    function getOrderDetails(bytes32 orderId) external view returns (
        address trader,
        uint256 publicNonce,
        uint256 blockNumber,
        bool executed,
        uint32 decryptedAmount,
        uint32 decryptedPrice
    ) {
        require(orders[orderId].trader != address(0), "Order does not exist");
        Order storage order = orders[orderId];
        
        return (
            order.trader,
            order.publicNonce,
            order.blockNumber,
            order.executed,
            order.decryptedAmount,
            order.decryptedPrice
        );
    }
    
    function getAllOrderIds() external view returns (bytes32[] memory) {
        return orderIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


