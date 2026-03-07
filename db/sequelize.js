const { Sequelize } = require('sequelize');
const oracledb = require('oracledb');

const sequelize = new Sequelize({
  dialect: 'oracle',
  dialectModule: oracledb,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || '',
  host: process.env.DB_CONNECT_STRING,
  logging: false,
  dialectOptions: {
    connectString: process.env.DB_CONNECT_STRING,
    configDir: process.env.TNS_ADMIN,
    walletLocation: process.env.TNS_ADMIN,
    walletPassword: process.env.WALLET_PASSWORD,
  },
});

module.exports = {
  sequelize,
};
