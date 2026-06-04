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
      },
      guildId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        field: 'guild_id',
      },
      musicInfo: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'music_info',
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
      modelName: 'MusicHistory',
      tableName: 'MUSIC_HISTORY',
      timestamps: true,
      updatedAt: false,
    },
  );

  return MusicHistory;
}