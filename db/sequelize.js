const { Sequelize } = require('sequelize');
const oracledb = require('oracledb');

const sequelize = new Sequelize({
  dialect: 'oracle',
  dialectModule: oracledb,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || '',
  logging: false,
  dialectOptions: {
    connectString: process.env.DB_CONNECT_STRING,
  },
});

module.exports = {
  sequelize,
};
