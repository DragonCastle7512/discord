import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { Sequelize } from 'sequelize';

export class KeywordPin extends Model<InferAttributes<KeywordPin>, InferCreationAttributes<KeywordPin>> {
  declare id: CreationOptional<number>;
  declare guildId: string;
  declare keyword: string;
  declare createdAt: CreationOptional<Date>;
}

export function initKeywordPinModel(sequelize: Sequelize): typeof KeywordPin {
  KeywordPin.init(
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
      modelName: 'KeywordPin',
      tableName: 'KEYWORD_PIN',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'IX_KW_PIN_GID_KW',
          unique: true,
          fields: ['guildId', 'keyword'],
        },
      ],
    },
  );

  return KeywordPin;
}
