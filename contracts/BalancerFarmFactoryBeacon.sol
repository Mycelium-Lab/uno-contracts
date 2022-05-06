// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {BalancerFarmUpgradeable as Farm, IERC20, Initializable, MerkleOrchard, IVault, IAsset} from "./farms/BalancerFarmUpgradeable.sol"; 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol"; 
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract BalancerFarmFactoryBeacon is Initializable, PausableUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmBeacon - Farm contract implementation.
     *
     * distributor - Address authorized to make distributions.
     * Farms - Links {lpPools} to the deployed Farm contract.
     * lpPools - List of pools that have corresponding deployed Farm contract.
     */
    address public farmBeacon;

    address public distributor;
    mapping(address => Farm) public Farms;
    address[] public lpPools;

    event FarmDeployed(address indexed farmAddress);
    event Deposit(address indexed sender, address indexed lpPool, uint256 amount);
    event Withdraw(address indexed sender, address indexed lpPool, uint256 amount);
    event Distribute(address indexed lpPool);
    event DistributorChanged(address indexed newDistributor);

    modifier distributorOnly(){
        require(msg.sender == distributor, 'Caller is not a distributor');
        _;
    }

    // ============ Methods ============

    function initialize(address upgrader) external initializer {
        __Pausable_init();
        __Ownable_init();
        _transferOwnership(upgrader);
        UpgradeableBeacon _farmBeacon = new UpgradeableBeacon(
            address(new Farm())
        );
        _farmBeacon.transferOwnership(upgrader);
        farmBeacon = address(_farmBeacon);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpPair and deposits tokens.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param amountLP - Amounts of LP tokens to deposit.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param recipient - Address which will recieve the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address lpPair, address recipient) external whenNotPaused returns(uint256 liquidity){
        require (amounts.length == tokens.length, "Amounts and tokens must have the same length");
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPools.push(lpPair);
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(Farms[lpPair]), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(Farms[lpPair]), amountLP);
        }

        liquidity = Farms[lpPair].deposit(amounts, tokens, amountLP, recipient);
        emit Deposit(recipient, lpPair, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will recieve tokens.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external whenNotPaused { 
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist'); 
        Farms[lpPair].withdraw(msg.sender, amount, withdrawLP, recipient); 
        emit Withdraw(msg.sender, lpPair, amount);
    }

     /**
     * @dev Distributes tokens between users for a single {Farms[lpPair]}.
     * @param lpPair - The pool to distribute. 
     * @param claims - Balancer token claims. 
     * @param rewardTokens - Reward tokens to recieve from the pool.
     * @param swaps - The data used to swap reward tokens for the needed tokens.
     * @param assets - The data used to swap reward tokens for the needed tokens.
     * @param funds - The data used to swap reward tokens for the needed tokens.
     * @param limits - The data used to swap reward tokens for the needed tokens.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPair,
        MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    )  external distributorOnly whenNotPaused {
        require(Farms[lpPair] != Farm(address(0)), 'The pool doesnt exist');
        require((swaps.length == assets.length) && (swaps.length == funds.length) && (swaps.length == limits.length));

        Farms[lpPair].distribute(claims, rewardTokens, swaps, assets, funds, limits);
        emit Distribute(lpPair);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
    function userStake(address _address, address lpPair) external view returns(uint256){
        if(Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].userBalance(_address);
        }
        return 0;
    }    
    
    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */ 
    function totalDeposits(address lpPair) external view returns (uint256) {
        if (Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].getTotalDeposits();
        }
        return 0;
    }

    function poolLength() external view returns (uint256){
        return lpPools.length;
    }

    function transferDistributor(address newDistributor) external onlyOwner{
        distributor = newDistributor;
        emit DistributorChanged(newDistributor);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Deploys new Farm contract and calls initialize on it.
     */
    function createFarm(address lpPair) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                Farm(address(0)).initialize.selector,
                lpPair
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }
}
