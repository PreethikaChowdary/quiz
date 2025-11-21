# Use Playwright image which already contains browsers and system deps
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copy package files first (layering)
COPY package.json package-lock.json* ./

# Install dependencies (playwright browsers are present in base image but install step ensures npm deps)
RUN npm ci --no-audit --no-fund

# Copy rest of project
COPY . .

# Expose port (Render will map)
EXPOSE 3000

# Default start
CMD ["npm", "start"]
