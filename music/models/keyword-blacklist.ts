import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { Sequelize } from 'sequelize';

export class KeywordBlacklist extends Model<InferAttributes<KeywordBlacklist>, InferCreationAttributes<KeywordBlacklist>> {
  declare id: CreationOptional<number>;
  declare guildId: string;
  declare keyword: string;
  declare createdAt: CreationOptional<Date>;
}

export function initKeywordBlacklistModel(sequelize: Sequelize): typeof KeywordBlacklist {
  KeywordBlacklist.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      guildId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        field: 'guild_id',
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
      modelName: 'KeywordBlacklist',
      tableName: 'KEYWORD_BLACKLIST',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          unique: true,
          fields: ['guild_id', 'keyword'],
        },
      ],
    },
  );

  return KeywordBlacklist;
}
