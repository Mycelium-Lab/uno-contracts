// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol';
import '@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol';
import '@openzeppelin/contracts/security/Pausable.sol';
import '../interfaces/IUnoAccessManager.sol'; 

contract UnoAutoStrategyFactory is Pausable {
    /**
     * @dev PoolInfo:
     * {assetRouter} - UnoAssetRouter contract.
     * {pool} - Pool address. 
     */
    struct PoolInfo {
        address assetRouter;
        address pool;
    }

    /**
     * @dev Contract Variables:
     * assetRouterApproved - Approved UnoAssetRouter contracts.
     
     * accessManager - Role manager contract.
     * autoStrategyBeacon - AutoStrategy contract implementation.
     * autoStrategies - list of deployed AutoStrategy contracts.
     */
    mapping(address => bool) public assetRouterApproved;

    IUnoAccessManager public accessManager;
    address public autoStrategyBeacon;
    address[] public autoStrategies;

    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');
    
    event AutoStrategyDeployed(address indexed autoStrategyAddress);
    event AssetRouterApproved(address indexed assetRouter);
    event AssetRouterRevoked(address indexed assetRouter);

    modifier onlyAdmin(){
        require(accessManager.hasRole(accessManager.ADMIN_ROLE(), msg.sender), 'CALLER_NOT_ADMIN');
        _;
    }
    modifier onlyPauser(){
        require(accessManager.hasRole(PAUSER_ROLE, msg.sender), 'CALLER_NOT_PAUSER');
        _;
    }

    // ============ Methods ============

    constructor (address _implementation, address _accessManager) {
        autoStrategyBeacon = address(new UpgradeableBeacon(_implementation));
        accessManager = IUnoAccessManager(_accessManager);
    }

    /**
     * @dev Checks if provided assetRouters are approved for use, then deploys new AutoStrategy contract.
     * @param poolInfos - An array of (assetRouter - pool) pairs. AssetRouter needs to be approved for PoolInfo to be valid. poolInfos.length must be >= 2.
     * @param name - AutoStrategy token name.
     * @param symbol - AutoStrategy token symbol.

     * @return autoStrategy - Deployed Auto Strategy contract address.
     */  
    function createStrategy(PoolInfo[] calldata poolInfos, string calldata name, string calldata symbol) whenNotPaused external returns (address) {
        for (uint256 i = 0; i < poolInfos.length; i++) {
            require(assetRouterApproved[poolInfos[i].assetRouter] == true, 'ASSET_ROUTER_NOT_APPROVED');
        }
        address autoStrategy = _createStrategy(poolInfos, name, symbol);
        autoStrategies.push(autoStrategy);
        return autoStrategy;
    }

    /**
     * @dev Approves an address for use as an AssetRouter. Emits {AssetRouterApproved} event.
     * @param _assetRouter - Asset router address to approve.

     * Note: This function can only be called by an admin.
     */  
    function approveAssetRouter(address _assetRouter) whenNotPaused external onlyAdmin {
        require(assetRouterApproved[_assetRouter] == false, 'ASSET_ROUTER_ALREADY_APPROVED');
        assetRouterApproved[_assetRouter] = true;
        emit AssetRouterApproved(_assetRouter);
    }

    /**
     * @dev Revokes Asset Router approval from an address. Emits {AssetRouterRevoked} event.
     * @param _assetRouter - Address to revoke approval from.

     * Note: This function can only be called by an admin.
     */ 
    function revokeAssetRouter(address _assetRouter) whenNotPaused external onlyAdmin {
        require(assetRouterApproved[_assetRouter] == true, 'ASSET_ROUTER_NOT_APPROVED');
        assetRouterApproved[_assetRouter] = false;
        emit AssetRouterRevoked(_assetRouter);
    }

    /**
     * @dev Upgrade all AutoStrategy contracts to a new implementation using Beacon Proxy.
     * @param newImplementation - New AutoStrategy implementation.

     * Note: This function can only be called by an admin.
     */ 
    function upgradeStrategies(address newImplementation) external onlyAdmin {
        UpgradeableBeacon(autoStrategyBeacon).upgradeTo(newImplementation);
    }

    /**
     * @dev Deploys new AutoStrategy contract and calls initialize() on it. Emits {AutoStrategyDeployed} event.
     */
    function _createStrategy(PoolInfo[] calldata poolInfos, string calldata name, string calldata symbol) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            autoStrategyBeacon,
            abi.encodeWithSelector(
                bytes4(keccak256('initialize((address,address)[],string,string,address)')),
                poolInfos,
                name,
                symbol,
                accessManager
            )
        );
        emit AutoStrategyDeployed(address(proxy));
        return address(proxy);
    }

    function autoStrategiesLength() external view returns (uint256) {
        return autoStrategies.length;
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }
}
