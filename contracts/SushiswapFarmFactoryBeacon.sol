// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {SushiswapFarmUpgradeable as Farm, SafeMath, IERC20, IUniswapV2Pair, Initializable} from "./farms/SushiswapFarmUpgradeable.sol"; 
 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract SushiswapFarmFactoryBeacon is Initializable{
    using SafeMath for uint256; 

    address public farmBeacon;

     /**
     * @dev Contract Variables:
     * {Farms} - links {lpPairs} to the deployed Farm contract.
     * {lpPairs} - list of pools that have corresponding deployed Farm contract.
     */
    mapping(address => Farm) public Farms;
    address[] public lpPairs;

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
     * {lpPair} - LP pool to deposit tokens to. 
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpPair) external {
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPairs.push(lpPair);
        }

        if(amountA > 0){
            IERC20 tokenA = IERC20(Farms[lpPair].tokenA());
            tokenA.transferFrom(msg.sender, address(Farms[lpPair]), amountA);
        }
        if(amountB > 0){
            IERC20 tokenB = IERC20(Farms[lpPair].tokenB());
            tokenB.transferFrom(msg.sender, address(Farms[lpPair]), amountB);
        }
        if(amountLP > 0){
            IERC20(lpPair).transferFrom(msg.sender, address(Farms[lpPair]), amountLP);
        }

        uint256 depositedAmount = Farms[lpPair].deposit(amountA, amountB, amountLP, msg.sender); 
        emit Deposit(msg.sender, lpPair, depositedAmount);
    }

    /**
     * @dev Withdraws tokens from the given pool. 
     * {lpStakingPool} - LP pool to withdraw from.
     * {withdrawLP} - true: Withdraw in LP tokens, false: Withdraw in tokens.
     */ 
    function withdraw(address lpPair, bool withdrawLP) external {  
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist');
        uint256 withdrawAmount = Farms[lpPair].withdraw(msg.sender, withdrawLP);
        emit Withdraw(msg.sender, lpPair, withdrawAmount);
    }

    /**
     * @dev Distributes tokens between users for a single { Farms[lpStakingPool] }.
     */ 
    function distribute(address lpPair) external {
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist');
        Farms[lpPair].distribute();
        emit Distribute(lpPair);
    }

    /**
     * @dev Returns token values staked by the user for the given {lpStakingPool}
     */
    function userStake(address _address, address lpPair) external view returns (uint256 lpStake, uint256 token0Stake, uint256 token1Stake) {
        if (Farms[lpPair] != Farm(address(0))) {
            lpStake = Farms[lpPair].userBalance(_address);

            uint256 totalSupply = IERC20(lpPair).totalSupply();
            uint256 totalToken0Amount = IERC20(Farms[lpPair].tokenA()).balanceOf(lpPair);
            token0Stake = lpStake.mul(totalToken0Amount).div(totalSupply);

            uint256 totalToken1Amount = IERC20(Farms[lpPair].tokenB()).balanceOf(lpPair);
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
    function totalDeposits(address lpPair) external view returns (uint256) {
        if (Farms[lpPair] != Farm(address(0))) {
            return Farms[lpPair].getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev poolLength()
     */
    function poolLength() external view returns (uint256) {
        return lpPairs.length;
    }

    function createFarm(address lpPair) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                Farm(address(0)).initialize.selector,
                lpPair,
                address(this)
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }
}