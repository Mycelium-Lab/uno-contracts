// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {SushiswapFarmUpgradeable as Farm, SafeMath, IERC20, IUniswapV2Pair, Initializable} from "./farms/SushiswapFarmUpgradeable.sol"; 
 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract SushiswapFarmFactoryBeacon is Initializable{
    using SafeMath for uint256; 

    /**
     * @dev Contract Variables:
     * {farmBeacon} - Farm contract implementation.
     *
     * {Farms} - Links {lpPools} to the deployed Farm contract.
     * {lpPools} - List of pools that have corresponding deployed Farm contract.
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
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpPair and deposits tokens.
     * {amountA, amountB} - Amounts of tokens to deposit.
     * {amountLP} - Amounts of LP tokens to deposit.
     * {lpPair} - Address of the pool to deposit tokens in.
     
     * {sentA, sentB} - Token amounts sent to the farm.
     * {liquidity} - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpPair) external returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPools.push(lpPair);
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

        (sentA, sentB, liquidity) = Farms[lpPair].deposit(amountA, amountB, amountLP, msg.sender); 
        emit Deposit(msg.sender, lpPair, liquidity);
    }

    /**
     * @dev Withdraws tokens from the given pool. 
     * {lpPair} - LP pool to withdraw from.
     * {amount} - LP amount to withdraw. 
     * {withdrawLP} - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * {recipient} - The address which will recieve tokens.

     * {amountA, amountB} - Token A amount sent to the {recipient}, 0 if withdrawLP == false.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB){  
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist');
        (amountA, amountB) = Farms[lpPair].withdraw(msg.sender, amount, withdrawLP, recipient);
        emit Withdraw(msg.sender, lpPair, amount);
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPair]}.
     */ 
    function distribute(address lpPair) external {
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist'); 
        Farms[lpPair].distribute();
        emit Distribute(lpPair);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpPair}.
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
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     */ 
    function totalDeposits(address lpPair) external view returns (uint256) {
        if (Farms[lpPair] != Farm(address(0))) {
            return Farms[lpPair].getTotalDeposits();
        }
        return 0;
    }

    function poolLength() external view returns (uint256) {
        return lpPools.length;
    }

    /**
     * @dev Deploys new Farm contract and calls initialize on it.
     */
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