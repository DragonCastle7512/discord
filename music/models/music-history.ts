import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { Sequelize } from 'sequelize';
import { Track } from '../types';

export class MusicHistory extends Model<InferAttributes<MusicHistory>, InferCreationAttributes<MusicHistory>> {
  declare id: CreationOptional<number>;
  declare guildId: string;
  declare musicInfo: Track;
  declare createdAt: CreationOptional<Date>;
}

export function initMusicHistoryModel(sequelize: Sequelize): typeof MusicHistory {
  MusicHistory.init(
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
      musicInfo: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'MUSIC_INFO',
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
      modelName: 'MusicHistory',
      tableName: 'MUSIC_HISTORY',
      timestamps: true,
      updatedAt: false,
    },
  );

  return MusicHistory;
}