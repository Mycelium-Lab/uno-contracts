// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {QuickswapFarmUpgradeable as Farm, SafeMath, IERC20, IUniswapV2Pair, Initializable} from "./farms/QuickswapFarmUpgradeable.sol";

import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract QuickswapFarmFactoryBeacon is Initializable{
    using SafeMath for uint256; 

    /**
     * @dev Contract Variables:
     * {farmBeacon} - Farm contract implementation.
     *
     * {Farms} - links {lpPools} to the deployed Farm contract.
     * {lpPools} - list of pools that have corresponding deployed Farm contract.
     */
    address public farmBeacon;

    mapping(address => Farm) public Farms;
    address[] public lpPools;

    event FarmDeployed(address indexed farmAddress);
    event Deposit(address indexed sender, address indexed lpPool, uint256 amount);
    event Withdraw(address indexed sender, address indexed lpPool, uint256 amount);
    event Distribute(address indexed lpPool);

    // ============ Methods ============

    function initialize(address upgrader) public initializer {
        UpgradeableBeacon _farmBeacon = new UpgradeableBeacon(
            address(new Farm())
        );
        _farmBeacon.transferOwnership(upgrader);
        farmBeacon = address(_farmBeacon);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpStakingPool and deposits tokens.
     * {amountA, amountB} - Amounts of tokens to deposit.
     * {amountLP} - Amounts of LP tokens to deposit.
     * {lpStakingPool} - Address of the pool to deposit tokens in.
     *
     * {sentA, sentB} - Token amounts sent to the farm.
     * {liquidity} - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpStakingPool) external returns(uint256 sentA, uint256 sentB, uint256 liquidity){
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
        
       (sentA, sentB, liquidity) = Farms[lpStakingPool].deposit(amountA, amountB, amountLP, msg.sender); 
        emit Deposit(msg.sender, lpStakingPool, liquidity); 
    }

    /**
     * @dev Withdraws tokens from the given pool. 
     * {lpStakingPool} - LP pool to withdraw from.
     * {amount} - LP amount to withdraw. 
     * {withdrawLP} - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * {recipient} - The address which will recieve tokens.
     *
     * {amountA, amountB} - Token amounts sent to the {recipient}, 0 if withdrawLP == false.
     */  
    function withdraw(address lpStakingPool, uint256 amount, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB){
        require(Farms[lpStakingPool] != Farm(address(0)), 'The given pool doesnt exist');
        (amountA, amountB) = Farms[lpStakingPool].withdraw(msg.sender, amount, withdrawLP, recipient); 
        emit Withdraw(msg.sender, lpStakingPool, amount);  
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpStakingPool]}.
     */ 
    function distribute(address lpStakingPool) external {
        require(Farms[lpStakingPool] != Farm(address(0)), 'The given pool doesnt exist');
        Farms[lpStakingPool].distribute();
        emit Distribute(lpStakingPool);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpStakingPool}.
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
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     */ 
    function totalDeposits(address lpStakingPool) external view returns (uint256) {
        if (Farms[lpStakingPool] != Farm(address(0))) {
            return Farms[lpStakingPool].getTotalDeposits();
        }
        return 0;
    }

    function poolLength() external view returns (uint256) {
        return lpPools.length;
    }
    
    /**
     * @dev Deploys new Farm contract and calls initialize on it.
     */
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
