//! tcp-kai — CLI к приложению tcp-kai: шлёт сохранённые в нём запросы к
//! микросервисам, не открывая GUI.
//!
//! База общая с приложением: коллекция = микросервис, пак переменных = стенд
//! (`local`/`prod`). Поэтому `tcp-kai coordinator get-domains -e prod` шлёт
//! ровно то же, что кнопка в приложении, и так же попадает в историю.
//!
//! Секреты (`--from-sec`) не хранятся в базе приложения, а приезжают из `sec`:
//! проект `tcp-kai-<ms>`, инстанс = имя пака.

mod cmd;
mod daemon;
mod sec;
mod vars;

use std::ffi::OsString;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "tcp-kai",
    // без bin_name в usage светился бы argv[0] — «tcp-kai-cli» при запуске
    // файла из бандла; команда для пользователя всегда tcp-kai
    bin_name = "tcp-kai",
    version,
    about = "Запросы к микросервисам по коллекциям tcp-kai (паки переменных, история общая с GUI)",
    after_help = "Примеры:\n  \
        tcp-kai coordinator read-recon-links-for-period\n  \
        tcp-kai coordinator get-domains -e local        # стенд вместо применённого в GUI\n  \
        echo '{\"limit\":10}' | tcp-kai whois get-domains --json | jq .\n  \
        tcp-kai fuzzing scan --var port=18099           # разовое значение\n  \
        tcp-kai notifier send --from-sec                # токен из sec, не из базы\n  \
        tcp-kai ls                                      # коллекции\n  \
        tcp-kai ls coordinator                          # запросы коллекции\n  \
        tcp-kai envs coordinator                        # паки переменных"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Отправить запрос (tcp-kai <ms> <cmd> — то же самое)
    Send(cmd::send::SendArgs),
    /// Коллекции, или запросы одной коллекции
    Ls(cmd::ls::LsArgs),
    /// Паки переменных, доступные коллекции
    Envs(cmd::envs::EnvsArgs),
    /// Импорт cmd-паттернов из NestJS-контракта в коллекцию
    Import(cmd::import::ImportArgs),
    /// Показать, что парсер найдёт в контракте (без импорта и базы)
    Parse(cmd::parse::ParseArgs),
    /// Последние обмены запроса из общей с GUI истории
    History(cmd::history::HistoryArgs),
    /// Keep-alive-демон: пул TCP-соединений между вызовами (run/status/stop)
    Daemon(cmd::daemon::DaemonArgs),
    /// Шелл-дополнения: tcp-kai completions zsh
    Completions {
        /// Шелл: bash, zsh, fish, elvish, powershell
        shell: clap_complete::Shell,
    },
}

/// `tcp-kai <ms> <cmd>` — шорткат для `tcp-kai send <ms> <cmd>`: если первый
/// аргумент не подкоманда и не флаг, считаем его именем коллекции.
///
/// Список подкоманд берём из самого clap, чтобы новая команда не начала молча
/// читаться как имя микросервиса.
fn preprocess_args() -> Vec<OsString> {
    use clap::CommandFactory;

    let command = Cli::command();
    let known: Vec<String> = command
        .get_subcommands()
        .flat_map(|c| {
            std::iter::once(c.get_name().to_string())
                .chain(c.get_all_aliases().map(str::to_string))
        })
        .chain(std::iter::once("help".to_string()))
        .collect();

    let mut args: Vec<OsString> = std::env::args_os().collect();
    if let Some(first) = args.get(1) {
        let s = first.to_string_lossy();
        if !s.starts_with('-') && !known.iter().any(|k| k == s.as_ref()) {
            args.insert(1, "send".into());
        }
    }
    args
}

fn main() -> ExitCode {
    let cli = Cli::parse_from(preprocess_args());
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");

    match rt.block_on(dispatch(cli)) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("tcp-kai: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn dispatch(cli: Cli) -> Result<ExitCode, String> {
    match cli.cmd {
        Cmd::Send(args) => cmd::send::run(args).await,
        Cmd::Ls(args) => cmd::ls::run(args).await,
        Cmd::Envs(args) => cmd::envs::run(args).await,
        Cmd::Import(args) => cmd::import::run(args).await,
        Cmd::Parse(args) => cmd::parse::run(args).await,
        Cmd::History(args) => cmd::history::run(args).await,
        Cmd::Daemon(args) => cmd::daemon::run(args).await,
        Cmd::Completions { shell } => {
            use clap::CommandFactory;
            let mut command = Cli::command();
            clap_complete::generate(shell, &mut command, "tcp-kai", &mut std::io::stdout());
            Ok(ExitCode::SUCCESS)
        }
    }
}
