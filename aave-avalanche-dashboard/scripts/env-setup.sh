#!/bin/bash
# Environment Setup Script
# Helps set up environment files from examples

set -e

ENV_TYPE=$1

if [ -z "$ENV_TYPE" ]; then
    echo "Usage: ./scripts/env-setup.sh [development|staging|production]"
    exit 1
fi

ENV_FILE=".env.${ENV_TYPE}"
EXAMPLE_FILE=".env.${ENV_TYPE}.example"

if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "Error: Example file $EXAMPLE_FILE not found"
    exit 1
fi

if [ -f "$ENV_FILE" ]; then
    echo "Warning: $ENV_FILE already exists"
    read -p "Overwrite? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted"
        exit 1
    fi
fi

cp "$EXAMPLE_FILE" "$ENV_FILE"
echo "Created $ENV_FILE from $EXAMPLE_FILE"
echo "Please edit $ENV_FILE and fill in your values"
echo "NEVER commit $ENV_FILE to git!"

