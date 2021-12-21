// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {QuickswapDualFarmUpgradeable as Farm, SafeMath, IERC20, IUniswapV2Pair, Initializable} from "./farms/QuickswapDualFarmUpgradeable.sol"; 

import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract QuickswapDualFarmFactoryBeacon is Initializable{
    using SafeMath for uint256; 

    address public farmBeacon;

    /**
     * @dev Contract Variables:
     * {Farms} - links {lpPools} to the deployed Farm contract.
     * {lpPools} - list of pools that have corresponding deployed Farm contract.
     */
    mapping(address => Farm) public Farms;
    address[] public lpPools;

    event FarmDeployed(address farmAddress);
    event Deposit(address sender, address lpPair, uint256 amount);
    event Withdraw(address sender, address lpPair, uint256 amount);
    event Distribute(address lpPair);

    // ============ Methods ============

    function initialize(address upgrader) public initializer {
        UpgradeableBeacon _farmBeacon = new UpgradeableBeacon(
            address(new Farm())
        );
        _farmBeacon.transferOwnership(upgrader);
        farmBeacon = address(_farmBeacon);
    }

    /**
     * @dev Creates a new contract if there isn't one and deposits LP tokens to the lpStakingPool.
     * {amount} - the amount of LP tokens to deposit.
     * {lpStakingPool} - LP pool to deposit tokens to. 
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpStakingPool) external {
        if(Farms[lpStakingPool] == Farm(address(0))){
            Farms[lpStakingPool] = Farm(createFarm(lpStakingPool));
            lpPools.push(lpStakingPool);
        }

        if(amountA > 0){
            IERC20 tokenA = IERC20(Farms[lpStakingPool].tokenA());
            tokenA.transferFrom(msg.sender, address(Farms[lpStakingPool]), amountA);
        }
        if(amountB > 0){
            IERC20 tokenB = IERC20(Farms[lpStakingPool].tokenB());
            tokenB.transferFrom(msg.sender, address(Farms[lpStakingPool]), amountB);
        }
        if(amountLP > 0){
            IERC20 lpPair = IERC20(Farms[lpStakingPool].lpPair());
            lpPair.transferFrom(msg.sender, address(Farms[lpStakingPool]), amountLP);
        }
        
        uint256 depositedAmount = Farms[lpStakingPool].deposit(amountA, amountB, amountLP, msg.sender); 
        emit Deposit(msg.sender, lpStakingPool, depositedAmount); 
    }

    /**
     * @dev Withdraws tokens from the given pool. 
     * {lpStakingPool} - LP pool to withdraw from.
     * {withdrawLP} - true: Withdraw in LP tokens, false: Withdraw in tokens.
     */ 
    function withdraw(address lpStakingPool, bool withdrawLP) external {
        require(Farms[lpStakingPool] != Farm(address(0)), 'The given pool doesnt exist');
        uint256 withdrawAmount = Farms[lpStakingPool].withdraw(msg.sender, withdrawLP); 
        emit Withdraw(msg.sender, lpStakingPool, withdrawAmount);
    }

     /**
     * @dev Distributes tokens between users for a single { Farms[lpStakingPool] }.
     */ 
    function distribute(address lpStakingPool) external {
        require(Farms[lpStakingPool] != Farm(address(0)), 'The given pool doesnt exist');
        Farms[lpStakingPool].distribute();
         emit Distribute(lpStakingPool);
    }

    /**
     * @dev Returns token values staked by the user for the given {lpStakingPool}
     */
    function userStake(address _address, address lpStakingPool) external view returns (uint256 lpStake, uint256 token0Stake, uint256 token1Stake) {
        if (Farms[lpStakingPool] != Farm(address(0))) {
            lpStake = Farms[lpStakingPool].userBalance(_address);
            address lpPair = Farms[lpStakingPool].lpPair();

            uint256 totalSupply = IERC20(lpPair).totalSupply();
            uint256 totalToken0Amount = IERC20(Farms[lpStakingPool].tokenA()).balanceOf(lpPair);
            token0Stake = lpStake.mul(totalToken0Amount).div(totalSupply);

            uint256 totalToken1Amount = IERC20(Farms[lpStakingPool].tokenB()).balanceOf(lpPair);
            token1Stake = lpStake.mul(totalToken1Amount).div(totalSupply);
        } else {
            lpStake = 0;
            token0Stake = 0;
            token1Stake = 0;
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take rewards after last distribution into account.
     */
    function totalDeposits(address lpStakingPool) external view returns (uint256) {
        if (Farms[lpStakingPool] != Farm(address(0))) {
            return Farms[lpStakingPool].getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev poolLength()
     */
    function poolLength() external view returns (uint256) {
        return lpPools.length;
    }
    
    function createFarm(address lpStakingPool) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                Farm(address(0)).initialize.selector,
                lpStakingPool,
                address(this)
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }
}