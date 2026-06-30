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
        field: 'ID',
      },
      guildId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        field: 'GUILD_ID',
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
      modelName: 'KeywordBlacklist',
      tableName: 'KEYWORD_BLACKLIST',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'k_e_y_w_o_r_d__b_l_a_c_k_l_i_s_t_guild_id_keyword',
          unique: true,
          fields: ['GUILD_ID', 'KEYWORD'],
        },
      ],
    },
  );

  return KeywordBlacklist;
}
