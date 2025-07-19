#!/bin/bash
# Script to deploy Safe WhatsApp Bot to Heroku

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Safe WhatsApp Bot - Heroku Deployment ===${NC}"
echo

# Check if Heroku CLI is installed
if ! command -v heroku &> /dev/null; then
    echo -e "${RED}Heroku CLI not found. Please install it first:${NC}"
    echo "https://devcenter.heroku.com/articles/heroku-cli"
    exit 1
fi

# Check if logged in to Heroku
echo -e "${YELLOW}Checking Heroku login status...${NC}"
heroku whoami &> /dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Please log in to Heroku:${NC}"
    heroku login
fi

# App name input
read -p "Enter a name for your Heroku app (letters, numbers, and dashes only): " APP_NAME

# Create Heroku app
echo -e "\n${YELLOW}Creating Heroku app: $APP_NAME${NC}"
heroku create $APP_NAME

# Add buildpacks
echo -e "\n${YELLOW}Adding buildpacks...${NC}"
heroku buildpacks:add --index 1 heroku/nodejs --app $APP_NAME
heroku buildpacks:add --index 2 https://github.com/jontewks/puppeteer-heroku-buildpack --app $APP_NAME

# Ask about MongoDB
echo -e "\n${YELLOW}Do you want to add MongoDB for persistent sessions? (recommended)${NC}"
read -p "This will add the MongoDB add-on to your Heroku app (y/n): " ADD_MONGO

if [[ $ADD_MONGO =~ ^[Yy]$ ]]; then
    echo -e "\n${YELLOW}Adding MongoDB...${NC}"
    heroku addons:create mongolab:sandbox --app $APP_NAME
fi

# Set environment variables
echo -e "\n${YELLOW}Setting environment variables...${NC}"
heroku config:set NODE_ENV=production --app $APP_NAME
heroku config:set HEROKU=true --app $APP_NAME

# Initialize Git if not already initialized
if [ ! -d ".git" ]; then
    echo -e "\n${YELLOW}Initializing git repository...${NC}"
    git init
fi

# Copy bot-package.json to package.json for deployment
echo -e "\n${YELLOW}Preparing package.json for deployment...${NC}"
cp bot-package.json package.json

# Use the Heroku-specific .gitignore
if [ -f ".gitignore-heroku" ]; then
    cp .gitignore-heroku .gitignore
fi

# Commit changes
echo -e "\n${YELLOW}Committing changes...${NC}"
git add .
git commit -m "Deploy to Heroku"

# Add Heroku remote
echo -e "\n${YELLOW}Adding Heroku remote...${NC}"
heroku git:remote -a $APP_NAME

# Push to Heroku
echo -e "\n${YELLOW}Pushing to Heroku...${NC}"
git push heroku main

# Start the web dyno
echo -e "\n${YELLOW}Starting web dyno...${NC}"
heroku ps:scale web=1 --app $APP_NAME

# Open the app
echo -e "\n${GREEN}Deployment complete! Opening app...${NC}"
heroku open --app $APP_NAME

echo -e "\n${GREEN}=== Deployment Complete ===${NC}"
echo -e "App URL: ${YELLOW}https://$APP_NAME.herokuapp.com${NC}"
echo -e "To view logs: ${YELLOW}heroku logs --tail --app $APP_NAME${NC}"
