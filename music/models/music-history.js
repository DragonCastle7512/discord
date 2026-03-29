const { DataTypes, Model, Sequelize } = require('sequelize');

class MusicHistory extends Model {}

function initMusicHistoryModel(sequelize) {
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
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
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

module.exports = {
  MusicHistory,
  initMusicHistoryModel,
};