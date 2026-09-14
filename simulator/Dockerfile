FROM ubuntu:22.04

# Avoid prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# Install OpenSSH Server, Python, and utilities
RUN apt-get update && apt-get install -y \
    openssh-server \
    python3 \
    python3-pip \
    procps \
    iproute2 \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Configure SSH
RUN mkdir /var/run/sshd
# Set root password to "password"
RUN echo 'root:password' | chpasswd
# Allow root login
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
# SSH login fix
RUN sed 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' -i /etc/pam.d/sshd

# Expose SSH and Python App ports
EXPOSE 22
EXPOSE 5000

# Setup Python App
WORKDIR /app
COPY requirements.txt .
RUN pip3 install -r requirements.txt
COPY app.py .

# Create log directory and file
RUN mkdir -p /var/log && touch /var/log/simulator.log && chmod 666 /var/log/simulator.log

# Start SSH daemon in background, then run Python app
CMD ["sh", "-c", "/usr/sbin/sshd && python3 app.py"]
