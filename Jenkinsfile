pipeline {
    agent any
    stages {
        stage('Deploy Discord Bot') {
            steps {
                dir('/var/jenkins_home/workspace/discord') {
                    dir('discord-bot') {
                        sh 'git config --global --add safe.directory /var/jenkins_home/workspace/discord/discord-bot'
                        sh 'git fetch --all && git reset --hard origin/main'
                    }
                    sh 'docker compose stop discord-bot'
                    sh 'docker compose up -d --build --no-deps discord-bot'
                }
            }
        }
    }
}