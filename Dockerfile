FROM mcr.microsoft.com/playwright:focal

WORKDIR /app

# Copy package.json only
COPY package.json ./

# Install dependencies
RUN npm install --no-audit --no-fund

# Copy all files
COPY . .

# Expose server port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
