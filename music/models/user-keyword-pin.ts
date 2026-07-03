import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { Sequelize } from 'sequelize';

export class UserKeywordPin extends Model<InferAttributes<UserKeywordPin>, InferCreationAttributes<UserKeywordPin>> {
  declare id: CreationOptional<number>;
  declare userId: string;
  declare keyword: string;
  declare createdAt: CreationOptional<Date>;
}

export function initUserKeywordPinModel(sequelize: Sequelize): typeof UserKeywordPin {
  UserKeywordPin.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        field: 'ID',
      },
      userId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        field: 'USER_ID',
      },
      keyword: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'KEYWORD',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'CREATED_AT',
      },
    },
    {
      sequelize,
      modelName: 'UserKeywordPin',
      tableName: 'USER_KEYWORD_PIN',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'IX_UKW_PIN_UID_KW',
          unique: true,
          fields: ['userId', 'keyword'],
        },
      ],
    },
  );

  return UserKeywordPin;
}
