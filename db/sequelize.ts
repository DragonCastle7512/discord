import { Sequelize } from 'sequelize';
// @ts-ignore
import oracledb from 'oracledb';

export const sequelize = new Sequelize({
  dialect: 'oracle',
  dialectModule: oracledb,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || '',
  logging: false,
  dialectOptions: {
    connectString: process.env.DB_CONNECT_STRING,
  },
  pool: {
    max: 20,
    min: 5,
    acquire: 30000,
    idle: 10000,
  },
});
