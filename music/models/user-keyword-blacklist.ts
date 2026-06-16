import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { Sequelize } from 'sequelize';

export class UserKeywordBlacklist extends Model<InferAttributes<UserKeywordBlacklist>, InferCreationAttributes<UserKeywordBlacklist>> {
  declare id: CreationOptional<number>;
  declare userId: string;
  declare keyword: string;
  declare createdAt: CreationOptional<Date>;
}

export function initUserKeywordBlacklistModel(sequelize: Sequelize): typeof UserKeywordBlacklist {
  UserKeywordBlacklist.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        field: 'user_id',
      },
      keyword: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'keyword',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'created_at',
      },
    },
    {
      sequelize,
      modelName: 'UserKeywordBlacklist',
      tableName: 'USER_KEYWORD_BLACKLIST',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          unique: true,
          fields: ['user_id', 'keyword'],
        },
      ],
    },
  );

  return UserKeywordBlacklist;
}
