pipeline {
    agent any
    stages {
        stage('Deploy Discord Bot') {
            steps {
                dir('/var/jenkins_home/workspace/discord-bot') {
                    sh 'git fetch --all && git reset --hard origin/main'
                    sh 'docker compose --env-file /var/jenkins_home/workspace/discord-bot/.env up -d --build --no-deps discord-bot'
                }
            }
        }
    }
}