"""Fixed container-only file/verification boundary. No shell interpolation."""
import base64
import ctypes
import hashlib
import json
import os
import pathlib
import pwd
import re
import resource
import signal
import stat
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

BASE = pathlib.Path('/home/murasame/activities')
LIMIT = 512 * 1024
TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'


def write_odf_text(node, text):
    for part in re.findall(r' +|\t|[^ \t]+', text):
        if part[0] == ' ':
            ET.SubElement(node, '{%s}s' % TEXT_NS, {'{%s}c' % TEXT_NS: str(len(part))})
        elif part == '\t':
            ET.SubElement(node, '{%s}tab' % TEXT_NS)
        elif len(node):
            node[-1].tail = (node[-1].tail or '') + part
        else:
            node.text = (node.text or '') + part


def read_odf_text(node):
    text = node.text or ''
    for child in node:
        if child.tag == '{%s}s' % TEXT_NS:
            count = int(child.attrib.get('{%s}c' % TEXT_NS, '1'))
            if count < 0 or count > 24000:
                raise ValueError('ODT空白数量无效')
            text += ' ' * count
        elif child.tag == '{%s}tab' % TEXT_NS:
            text += '\t'
        elif child.tag == '{%s}line-break' % TEXT_NS:
            text += '\n'
        else:
            text += read_odf_text(child)
        text += child.tail or ''
    return text


def read_plain(path, limit=LIMIT):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError('产物不是有效的有界普通文件')
        with os.fdopen(os.dup(fd), 'rb') as source:
            data = source.read(limit + 1)
        if len(data) > limit:
            raise ValueError('产物超过大小限制')
        return data
    finally:
        os.close(fd)


def folder(payload):
    if not re.fullmatch(r'[a-f0-9-]{36}', payload['activityId']) or payload['attempt'] not in (0, 1):
        raise ValueError('活动目录无效')
    target = BASE / payload['activityId'] / str(payload['attempt'])
    for parent in [BASE, target.parent, target]:
        if parent.is_symlink():
            raise ValueError('拒绝符号链接目录')
    return target


def limited_code():
    os.setsid()
    identity = pwd.getpwnam('murasame-code')
    os.setgroups([])
    os.setgid(identity.pw_gid)
    os.setuid(identity.pw_uid)
    resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_FSIZE, (256 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
    # A generated script cannot reach the desktop editor/VNC sockets or signal
    # the trusted collector. Filters survive exec and cannot be removed.
    lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    ctx = lib.seccomp_init(0x7fff0000)
    if not ctx:
        raise RuntimeError('代码执行过滤器无法创建')
    try:
        for name in ('socket', 'socketpair', 'ptrace', 'process_vm_readv', 'process_vm_writev', 'kill', 'tkill', 'tgkill', 'pidfd_open', 'pidfd_getfd', 'pidfd_send_signal', 'mount', 'unshare', 'setns'):
            call = lib.seccomp_syscall_resolve_name(name.encode())
            if call >= 0 and lib.seccomp_rule_add(ctx, 0x00050001, call, 0) != 0:
                raise RuntimeError('代码执行过滤器无法配置')
        if lib.seccomp_load(ctx) != 0:
            raise RuntimeError('代码执行过滤器无法启用')
    finally:
        lib.seccomp_release(ctx)


def office_user():
    identity = pwd.getpwnam('murasame')
    os.setgroups([])
    os.setgid(identity.pw_gid)
    os.setuid(identity.pw_uid)


def evidence(target, kind, stdout='', stderr='', exit_code=0, timed_out=False):
    name = 'main.py' if kind == 'code' else 'document.odt'
    data = read_plain(target / name)
    if kind == 'code':
        text = data.decode('utf-8')
    else:
        with zipfile.ZipFile(target / name) as archive:
            if archive.read('mimetype') != b'application/vnd.oasis.opendocument.text':
                raise ValueError('不是ODT文字文档')
            info = archive.getinfo('content.xml')
            if info.file_size > LIMIT:
                raise ValueError('ODT正文过大')
            content = ET.fromstring(archive.read(info))
        text = '\n'.join(read_odf_text(node) for node in content.iter() if node.tag in (
            '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}p',
            '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}h'))
    return dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), base64=base64.b64encode(data).decode(),
                text=text, stdout=stdout, stderr=stderr, exitCode=exit_code, timedOut=timed_out)


def execute(payload):
    target = folder(payload)
    kind = payload['kind']
    if kind not in ('code', 'office'):
        raise ValueError('不支持的创作类型')
    if payload['action'] == 'read':
        return evidence(target, kind)
    if payload['action'] != 'create':
        raise ValueError('无效操作')
    draft = payload['draft']
    title, content = draft['title'], draft['content']
    if not isinstance(content, str) or not content.strip() or len(content) > 24000 or len(title) > 120:
        raise ValueError('候选内容无效')
    target.mkdir(parents=True, exist_ok=False)
    if kind == 'office':
        identity = pwd.getpwnam('murasame')
        os.chown(target, identity.pw_uid, identity.pw_gid)
        office = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
        txt = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
        ET.register_namespace('office', office)
        ET.register_namespace('text', txt)
        document = ET.Element('{%s}document' % office, {'{%s}version' % office: '1.2', '{%s}mimetype' % office: 'application/vnd.oasis.opendocument.text'})
        body = ET.SubElement(ET.SubElement(document, '{%s}body' % office), '{%s}text' % office)
        write_odf_text(ET.SubElement(body, '{%s}h' % txt, {'{%s}outline-level' % txt: '1'}), title)
        for line in content.replace('\r\n', '\n').split('\n'):
            write_odf_text(ET.SubElement(body, '{%s}p' % txt), line)
        ET.ElementTree(document).write(target / 'document.fodt', encoding='utf-8', xml_declaration=True)
        conversion = subprocess.run(['libreoffice', '-env:UserInstallation=file:///tmp/murasame-convert-' + payload['activityId'], '--headless', '--convert-to', 'odt', '--outdir', str(target), str(target / 'document.fodt')], capture_output=True, timeout=40, preexec_fn=office_user, env={**os.environ, 'HOME': '/home/murasame'})
        if conversion.returncode:
            raise ValueError('LibreOffice没有成功保存文档')
        return evidence(target, kind)
    with open(target / 'main.py', 'x', encoding='utf-8', newline='') as output:
        output.write(content)
    timed_out = False
    # Root owns the candidate and collector files. The child has a separate UID
    # and only inherited output descriptors, never write access to their paths.
    with open(target / 'stdout.txt', 'xb') as out, open(target / 'stderr.txt', 'xb') as err:
        os.chmod(target / 'stdout.txt', 0o600)
        os.chmod(target / 'stderr.txt', 0o600)
        child = subprocess.Popen(['python3', '-I', '-B', str(target / 'main.py')], cwd=target, stdout=out, stderr=err, preexec_fn=limited_code)
        try:
            exit_code = child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(child.pid, signal.SIGKILL)
            exit_code = child.wait(timeout=3)
    stdout = read_plain(target / 'stdout.txt', 32000).decode('utf-8', errors='replace')
    stderr = read_plain(target / 'stderr.txt', 32000).decode('utf-8', errors='replace')
    return evidence(target, kind, stdout, stderr, exit_code, timed_out)


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(120001)
        if len(raw) > 120000:
            raise ValueError('请求过大')
        print(json.dumps(execute(json.loads(raw)), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)[:500]}, ensure_ascii=False))
        sys.exit(1)
