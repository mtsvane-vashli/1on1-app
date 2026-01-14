FROM node:20-slim

WORKDIR /app

# Install dependencies based on package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Expose the default Next.js port
EXPOSE 3000

# Start the application in development mode
# Binding to 0.0.0.0 is often necessary for Docker
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
