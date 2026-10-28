# 国内网络下 Docker Hub 和 deb.debian.org 经常连不上。应用会自动带上这两个参数重试，
# 不用用户自己配：
#   --build-arg BASE_IMAGE=docker.m.daocloud.io/library/debian:bookworm
#   --build-arg APT_MIRROR=mirrors.aliyun.com,mirrors.tuna.tsinghua.edu.cn
ARG BASE_IMAGE=debian:bookworm
FROM ${BASE_IMAGE}

ARG APT_MIRROR=
ENV DEBIAN_FRONTEND=noninteractive

# APT_MIRROR 用逗号分隔多个软件源。同一个包从第一个下不来时，apt 会改从下一个下。
# 超时设短一些，避免一个下不来的包把整次准备卡上好几分钟。
RUN set -eu; \
    printf 'Acquire::Retries "2";\nAcquire::http::Timeout "30";\n' > /etc/apt/apt.conf.d/80-murasame; \
    if [ -n "$APT_MIRROR" ]; then \
      uris=""; sec=""; \
      oldifs=$IFS; IFS=','; \
      for host in $APT_MIRROR; do \
        uris="$uris http://$host/debian"; \
        sec="$sec http://$host/debian-security"; \
      done; \
      IFS=$oldifs; \
      printf 'Types: deb\nURIs:%s\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs:%s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$uris" "$sec" > /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update

# 只装这次真正用得到的，分几层装：网络中途断了，重试时已经装好的层直接用缓存。
# 办公、编辑器与浏览器一次构建完成。
# 画面、截图和点击：Xvnc 出画面，noVNC 在浏览器里看，scrot 截图，xdotool 点击和输入。
RUN apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    tigervnc-standalone-server novnc websockify python3 supervisor ca-certificates dbus-x11 xdotool scrot pulseaudio

# 桌面。
RUN apt-get -o Acquire::Retries=5 install -y --no-install-recommends xfce4 xfce4-terminal

# 浏览器和中文字体。没有中文字体，中文网页在截图里是方块，看图模型读不出来。
RUN apt-get -o Acquire::Retries=5 install -y --no-install-recommends firefox-esr fonts-wqy-microhei

RUN apt-get -o Acquire::Retries=5 install -y --no-install-recommends libreoffice-writer libreoffice-calc python3-uno

# Official pinned release, checked by BuildKit before installation.
# https://github.com/coder/code-server/releases/tag/v4.143.1
ADD --checksum=sha256:e4b771c98fafbe2af3990ecd71d93ba22515588db550007076768a014ae34c02 https://github.com/coder/code-server/releases/download/v4.143.1/code-server_4.143.1_amd64.deb /tmp/code-server.deb
RUN dpkg -i /tmp/code-server.deb && rm /tmp/code-server.deb

# 桌面程序都以这个普通用户运行，不给 sudo。
RUN useradd --create-home --shell /bin/bash murasame && useradd --no-create-home --shell /usr/sbin/nologin murasame-code && \
    apt-get -o Acquire::Retries=5 install -y --no-install-recommends libseccomp2

COPY firefox-policies.json /usr/lib/firefox-esr/distribution/policies.json
COPY supervisord.conf /etc/supervisor/conf.d/murasame.conf
COPY creation-runner.py /opt/murasame/creation-runner.py
COPY --chown=murasame:murasame office-registry.xcu /home/murasame/.config/libreoffice/4/user/registrymodifications.xcu
COPY --chown=murasame:murasame editor-settings.json /home/murasame/.local/share/code-server/User/settings.json
EXPOSE 6901
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/murasame.conf"]

# Runtime contract: Firefox BiDi playback/observation endpoint and profile-scoped ownership.
LABEL io.murasame.isolation.schema="3"
