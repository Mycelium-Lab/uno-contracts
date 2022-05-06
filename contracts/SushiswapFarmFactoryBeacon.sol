// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {SushiswapFarmUpgradeable as Farm, IERC20, IERC20Upgradeable, SafeERC20Upgradeable, Initializable} from "./farms/SushiswapFarmUpgradeable.sol"; 
 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract SushiswapFarmFactoryBeacon is Initializable, PausableUpgradeable, OwnableUpgradeable {
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
        require(msg.sender == distributor);
        _;
    }

    // ============ Methods ============

    function initialize(address upgrader) external initializer {
        __Pausable_init();
        __Ownable_init();
        _transferOwnership(upgrader);
        farmBeacon = address(new UpgradeableBeacon(
            address(new Farm())
        ));
        UpgradeableBeacon(farmBeacon).transferOwnership(upgrader);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpPair and deposits tokens.
     * @param amountA  - Token A amount to deposit.
     * @param amountB -  Token B amount to deposit.
     * @param amountLP - LP Token amount to deposit.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param recipient - Address which will recieve the deposit and leftover tokens.
     
     * @return sentA - Token A amount sent to the farm.
     * @return sentB - Token B amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpPair, address recipient) external whenNotPaused returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPools.push(lpPair);
        }

        if(amountA > 0){
            IERC20Upgradeable(Farms[lpPair].tokenA()).safeTransferFrom(msg.sender, address(Farms[lpPair]), amountA);
        }
        if(amountB > 0){
            IERC20Upgradeable(Farms[lpPair].tokenB()).safeTransferFrom(msg.sender, address(Farms[lpPair]), amountB);
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(Farms[lpPair]), amountLP);
        }

        (sentA, sentB, liquidity) = Farms[lpPair].deposit(amountA, amountB, amountLP, recipient); 
        emit Deposit(recipient, lpPair, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will recieve tokens.

     * @return amountA - Token A amount sent to the {recipient}, 0 if withdrawLP == false.
     * @return amountB - Token B amount sent to the {recipient}, 0 if withdrawLP == false.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external whenNotPaused returns(uint256 amountA, uint256 amountB){  
        require(Farms[lpPair] != Farm(address(0)));
        (amountA, amountB) = Farms[lpPair].withdraw(msg.sender, amount, withdrawLP, recipient);
        emit Withdraw(msg.sender, lpPair, amount);
    }

    /**
     * @dev Sets expected reward amount and block for token distribution calculations.
     * @param lpPair - LP pool to check total deposits in.
     * @param expectedReward - New reward amount.
     * @param expectedRewardBlock - New reward block.
     *
     * Note: This function can only be called by the distributor.
     */  
    function setExpectedReward(address lpPair, uint256 expectedReward, uint256 expectedRewardBlock) external distributorOnly {
        require(Farms[lpPair] != Farm(address(0)));
        Farms[lpPair].setExpectedReward(expectedReward, expectedRewardBlock); 
    }

    /**
     * @dev Distributes tokens between users.
     * @param lpPair - LP pool to distribute tokens in.
     * @param rewarderTokenToTokenARoute An array of token addresses.
     * @param rewarderTokenToTokenBRoute An array of token addresses.
     * @param rewardTokenToTokenARoute An array of token addresses.
     * @param rewardTokenToTokenBRoute An array of token addresses.
     *
     * Note: This function can only be called by the distributor.
     */ 
    function distribute(
        address lpPair,
        address[] calldata rewarderTokenToTokenARoute,
        address[] calldata rewarderTokenToTokenBRoute,
        address[] calldata rewardTokenToTokenARoute,
        address[] calldata rewardTokenToTokenBRoute
    ) external distributorOnly whenNotPaused{
        require(Farms[lpPair] != Farm(address(0))); 
        
        Farms[lpPair].distribute(rewarderTokenToTokenARoute, rewarderTokenToTokenBRoute, rewardTokenToTokenARoute, rewardTokenToTokenBRoute);
        emit Distribute(lpPair);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return stakeLP - Total user stake(in LP tokens).
     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address, address lpPair) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB) {
        if (Farms[lpPair] != Farm(address(0))) {
            stakeLP = Farms[lpPair].userBalance(_address);
            (stakeA, stakeB) = getTokenStake(lpPair, stakeLP);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */ 
    function totalDeposits(address lpPair) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB) {
        if (Farms[lpPair] != Farm(address(0))) {
            totalDepositsLP = Farms[lpPair].totalDeposits();
            (totalDepositsA, totalDepositsB) = getTokenStake(lpPair, totalDepositsLP);
        }
    }

    function poolLength() external view returns (uint256) {
        return lpPools.length;
    }

    function transferDistributor(address newDistributor) external onlyOwner {
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
     * @dev Converts LP tokens to normal tokens, value(amountA) == value(amountB) == 0.5*amountLP
     * @param lpPair - LP pool to check total deposits in.
     * @param amountLP - Amount of LP tokens to convert.

     * @return amountA - Token A amount.
     * @return amountB - Token B amount.
     */ 
    function getTokenStake(address lpPair, uint256 amountLP) internal view returns (uint256 amountA, uint256 amountB) {
        if (Farms[lpPair] != Farm(address(0))) {
            uint256 totalSupply = IERC20(lpPair).totalSupply();
            amountA = amountLP * IERC20(Farms[lpPair].tokenA()).balanceOf(lpPair) / totalSupply;
            amountB = amountLP * IERC20(Farms[lpPair].tokenB()).balanceOf(lpPair) / totalSupply;
        }
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